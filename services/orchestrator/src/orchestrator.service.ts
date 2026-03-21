import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, QueueEvents } from 'bullmq';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';
import { AgentMessage, ActivityEvent } from '@concaretti/shared-types';

@Injectable()
export class OrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(OrchestratorService.name);
  private gemini: GoogleGenerativeAI | null = null;
  private subRedis: Redis;
  private queueEvents: Record<string, QueueEvents> = {};
  private queues: Record<string, Queue> = {};

  constructor(
    @InjectQueue('research') private researchQueue: Queue,
    @InjectQueue('email') private emailQueue: Queue,
    @InjectQueue('file_code') private fileCodeQueue: Queue,
    @InjectQueue('chaos') private chaosQueue: Queue,
    @InjectQueue('github') private githubQueue: Queue,
    @InjectQueue('news') private newsQueue: Queue,
    @InjectQueue('scheduler') private schedulerQueue: Queue,
    private eventEmitter: EventEmitter2
  ) {
    if (process.env.GEMINI_API_KEY) {
      this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }
    
    this.queues = {
      research: researchQueue,
      email: emailQueue,
      file_code: fileCodeQueue,
      chaos: chaosQueue,
      github: githubQueue,
      news: newsQueue,
      scheduler: schedulerQueue
    };

    this.subRedis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });
    this.subRedis.subscribe('activity_events');
    this.subRedis.on('message', (channel, message) => {
      if (channel === 'activity_events') {
        try {
          const { sessionId, event } = JSON.parse(message);
          this.emitEvent(sessionId, event);
        } catch (e) {
          this.logger.error('Failed to parse activity event message', e);
        }
      }
    });
  }

  onModuleInit() {
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    };

    Object.keys(this.queues).forEach(name => {
      this.queueEvents[name] = new QueueEvents(name, { connection: redisConfig });
    });
    this.logger.log('Orchestrator V2 Initialized: Sequential Workflow Engine Active.');
  }

  private emitEvent(sessionId: string, event: ActivityEvent) {
    this.eventEmitter.emit(`session.${sessionId}`, event);
  }

  async orchestrateTask(sessionId: string, prompt: string) {
    this.logger.log(`Received task for session ${sessionId}: ${prompt}`);

    const GEMINI_MODELS = [
      "gemini-2.0-flash",
      "gemini-2.5-flash-lite",
      "gemini-3.1-flash-lite-preview",
      "gemini-flash-latest"
    ];
    const modelId = GEMINI_MODELS[Math.floor(Math.random() * GEMINI_MODELS.length)];

    this.emitEvent(sessionId, {
      agent_name: 'orchestrator',
      type: 'update',
      content: `Prompt received. Decomposing task via Gemini Cluster (${modelId})...`,
      timestamp: new Date().toISOString()
    });

    let subTasks: any[] = [];

    if (this.gemini) {
      try {
        const model = this.gemini.getGenerativeModel({
          model: modelId, systemInstruction: `You are the Concaretti Orchestrator (V2). 
            Decompose the user's prompt into sub-tasks. You MUST follow this strict schema for AGENTS and TASK_TYPES:
            - agent: "research" -> task_type: "web_search" (payload: { "query": string })
            - agent: "email" -> task_type: "draft_email" | "send_email" (payload: { "context": string, "recipient": string, "subject": string, "body": string })
            - agent: "file_code" -> task_type: "file_write" | "file_read" | "script_execute" (payload: { "target_path": string, "content": string, "script_command": string })
            - agent: "chaos" -> task_type: "adventurous" (payload: { "prompt": string })
            - agent: "github" -> task_type: "monitor_repo" | "check_pr" | "check_ci" (payload: { "repo": string })
            - agent: "news" -> task_type: "get_digest" (payload: { "topic": string })
            - agent: "scheduler" -> task_type: "schedule_prompt" (payload: { "prompt": string, "cron": string })

            IMPORTANT: 
            1. For "file_write", output RAW content only. NO JSON wrapping.
            2. Research should come first. 
            3. Subsequent tasks will receive context from previous completions automatically.
            
            Output strictly valid JSON: { "subtasks": [ { "agent": "...", "task_type": "...", "payload": {...}, "priority": "high|normal|low" } ] }`});

        const response = await model.generateContent(prompt);
        const text = response.response.text();
        const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
        subTasks = parsed.subtasks;
      } catch (e: any) {
        this.logger.error(`Failed to parse Gemini JSON: ${e.message}`);
      }
    }

    if (!subTasks || subTasks.length === 0) {
      this.logger.warn("No subtasks generated. Falling back to simple dispatch.");
      return { status: "error", message: "Failed to decompose task." };
    }

    let accumulatedContext = "";

    // SEQUENTIAL WORKFLOW EXECUTION
    for (const task of subTasks) {
      const enhancedPayload = {
        ...task.payload,
        context: task.payload.context ? `${task.payload.context}\n\n[PREVIOUS_CONTEXT]: ${accumulatedContext}` : accumulatedContext
      };

      const message: AgentMessage = {
        message_id: uuidv4(),
        session_id: sessionId,
        from_agent: 'orchestrator',
        to_agent: task.agent as any,
        task_type: task.task_type,
        payload: enhancedPayload,
        priority: task.priority as any,
        timestamp: new Date().toISOString()
      };

      this.emitEvent(sessionId, {
        agent_name: 'orchestrator',
        type: 'update',
        content: `Step ${subTasks.indexOf(task) + 1}: Dispatching ${task.task_type} to ${task.agent.toUpperCase()}...`,
        timestamp: new Date().toISOString()
      });

      const queue = this.queues[task.agent];
      if (!queue) {
        this.logger.error(`Unknown agent: ${task.agent}`);
        continue;
      }

      // PERSISTENCE: Record task start in Redis
      const taskId = uuidv4();
      const taskRecord = {
        taskId,
        agent: task.agent,
        taskType: task.task_type,
        status: 'running',
        timestamp: new Date().toISOString()
      };
      await this.subRedis.hset(`orch:history:${sessionId}`, taskId, JSON.stringify(taskRecord));

      const job = await queue.add('task', message);

      // Await result for context propagation
      try {
        const result = await job.waitUntilFinished(this.queueEvents[task.agent]);
        
        // PERSISTENCE: Record task completion
        const completedRecord = { 
          ...taskRecord, 
          status: 'complete', 
          result: result?.synthesis || result?.result 
        };
        await this.subRedis.hset(`orch:history:${sessionId}`, taskId, JSON.stringify(completedRecord));

        if (result && (result.synthesis || result.result)) {
           accumulatedContext += `\n[From ${task.agent}]: ${result.synthesis || result.result}`;
        }
      } catch (err) {
        this.logger.error(`Subtask ${task.task_type} failed: ${err.message}`);
        await this.subRedis.hset(`orch:history:${sessionId}`, taskId, JSON.stringify({ ...taskRecord, status: 'error', error: err.message }));
      }
    }

    return {
      task_id: uuidv4(),
      status: "complete",
      context_length: accumulatedContext.length
    };
  }
}
