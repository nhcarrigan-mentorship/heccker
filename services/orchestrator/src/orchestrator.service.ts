import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, QueueEvents } from 'bullmq';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModelRotator } from './utils/ModelRotator';
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';
import { PrismaService } from './prisma.service';

// Local types if shared-types resolution fails
export interface AgentMessage {
  message_id: string;
  session_id: string;
  from_agent: string;
  to_agent: string;
  task_type: string;
  payload: any;
  priority: 'high' | 'normal' | 'low';
  timestamp: string;
}

export interface ActivityEvent {
  agent_name: string;
  type: 'update' | 'result' | 'error' | 'artifact';
  content?: string;
  artifact?: string;
  timestamp: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  summary: string;
  date: string;
  agents: string[];
}

@Injectable()
export class OrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(OrchestratorService.name);
  private gemini: GoogleGenerativeAI | null = null;
  private subRedis: Redis;
  private redis: Redis;
  private queueEvents: Record<string, QueueEvents> = {};
  private queues: Record<string, Queue> = {};
  private modelRotator = new ModelRotator();
  private cachedConfig: any = null;

  constructor(
    @InjectQueue('research') private researchQueue: Queue,
    @InjectQueue('email') private emailQueue: Queue,
    @InjectQueue('file-code') private fileCodeQueue: Queue,
    @InjectQueue('chaos') private chaosQueue: Queue,
    @InjectQueue('github') private githubQueue: Queue,
    @InjectQueue('news') private newsQueue: Queue,
    @InjectQueue('scheduler') private schedulerQueue: Queue,
    @InjectQueue('health') private healthQueue: Queue,
    @InjectQueue('coding') private codingQueue: Queue,
    @InjectQueue('deploy') private deployQueue: Queue,
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2
  ) {
    if (process.env.GEMINI_API_KEY) {
      this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }

    this.queues = {
      research: researchQueue,
      email: emailQueue,
      'file-code': fileCodeQueue,
      chaos: chaosQueue,
      github: githubQueue,
      news: newsQueue,
      scheduler: schedulerQueue,
      health: healthQueue,
      coding: codingQueue,
      deploy: deployQueue
    };

    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });

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

  private async prismaRetry<T>(fn: () => Promise<T>, retries = 10): Promise<T> {
    let lastError: any;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err: any) {
            lastError = err;
            if (err.code === 'P1001' || (err.message && err.message.includes("Can't reach database"))) {
                this.logger.error(`Database connection dropped. Attempt ${i + 1}/${retries}. Retrying in ${Math.min(2000 * (i + 1), 10000)}ms...`);
                await new Promise(res => setTimeout(res, Math.min(2000 * (i + 1), 10000)));
                continue;
            }
            throw err;
        }
    }
    throw lastError;
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

  private async emitEvent(sessionId: string, event: ActivityEvent) {
    this.eventEmitter.emit(`session.${sessionId}`, event);
    
    // Persist to database for history
    try {
      await this.prisma.activityEvent.create({
        data: {
          sessionId,
          agentName: event.agent_name,
          type: event.type,
          content: event.content || event.artifact || "",
          timestamp: new Date(event.timestamp)
        }
      });
    } catch (e) {
      this.logger.error(`Failed to persist activity event for session ${sessionId}`, e);
    }
  }

  private async fetchConfig() {
    try {
      // Config service is on port 3006
      const response = await fetch('http://localhost:3006/config');
      if (response.ok) {
        const json = await response.json();
        this.cachedConfig = json.data;
        this.logger.log(`Orchestrator successfully synced with Config Service.`);
      }
    } catch (e: any) {
      this.logger.warn(`Orchestrator failed to fetch remote config: ${e.message}. Using internal defaults.`);
    }
  }

  private async dispatchToMCP(connector: any, task: any, sessionId: string): Promise<any> {
    this.logger.log(`Dispatching to MCP Connector: ${connector.name} (${connector.mcp})`);
    
    this.emitEvent(sessionId, {
      agent_name: 'orchestrator',
      type: 'update',
      content: `Establishing MCP connection to ${connector.name.toUpperCase()}...`,
      timestamp: new Date().toISOString()
    });

    try {
      const response = await fetch(connector.mcp, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': connector.token ? `Bearer ${this.interpolateToken(connector.token)}` : ''
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "call_tool", // Standard MCP pattern
          params: {
            name: task.task_type,
            arguments: task.payload
          },
          id: uuidv4()
        })
      });

      if (!response.ok) {
        throw new Error(`MCP Error ${response.status}: ${await response.text()}`);
      }

      const result = await response.json();
      return result.result || result;
    } catch (e: any) {
      this.logger.error(`MCP Dispatch failed for ${connector.name}: ${e.message}`);
      throw e;
    }
  }

  private interpolateToken(token: string): string {
    if (token.startsWith('$')) {
      const envKey = token.substring(1);
      return process.env[envKey] || token;
    }
    return token;
  }

  async orchestrateTask(sessionId: string, prompt: string, retryCount = 0): Promise<any> {
    const maxRetries = this.modelRotator.getAvailableModels().length;
    const modelId = this.modelRotator.getCurrentModel();
    
    this.logger.log(`Received task for session ${sessionId}: ${prompt} (Using ${modelId})`);

    // Create session in database
    await this.prismaRetry(() => this.prisma.session.upsert({
      where: { id: sessionId },
      update: { title: prompt.substring(0, 50) },
      create: { id: sessionId, title: prompt.substring(0, 50), createdAt: new Date() }
    }));

    this.emitEvent(sessionId, {
      agent_name: 'orchestrator',
      type: 'update',
      content: `Prompt received. Decomposing task via Gemini Cluster (${modelId})...`,
      timestamp: new Date().toISOString()
    });

    let subTasks: any[] = [];

    // 1. Refresh Config
    await this.fetchConfig();
    const connectors = this.cachedConfig?.connectors || [];
    const connectorDescriptions = connectors.map((c: any) => `- agent: "${c.name}" -> task_type: "any" (MCP Connector at ${c.mcp})`).join('\n');

    if (this.gemini) {
        try {
          const model = this.gemini.getGenerativeModel({
            model: modelId, 
              systemInstruction: `You are the Concaretti Orchestrator (V2). 
              Decompose the user's prompt into logical sub-tasks.
              
              STRICT DISPATCHING RULES:
              1. FILE ANALYSIS/READING: Assign ANY task involving reading, summarizing, analyzing, or extracting info from documents (.docx, .pdf, .csv, .txt, .md) ONLY to "file-code".
              2. FILE WRITING/OPS: Assign any file_write, file_copy, file_move, file_delete ONLY to "file-code".
              3. CODING: ONLY assign "coding" (implement_logic, refactor) for actual software implementation tasks (writing functions, classes, fixing logic bugs in code). NEVER use "coding" for general text summarization or reading files.
              4. CHAOS: ONLY for experimental or creative prompts. Never for file ops.
              
              AGENT SCHEMA (SKILLS):
              - agent: "research" -> task_type: "web_search" | "deep_research" (STRICT: Always extract specific URLs and personal/company names from the user prompt into the "query" field. If a URL is mentioned, that is YOUR PRIMARY QUERY.)
              - agent: "email" -> task_type: "draft_email" | "send_email" | "search_emails"
              - agent: "file-code" -> task_type: "file_write" | "file_read" | "file_copy" | "file_move" | "file_delete" | "script_execute" | "python_execute" (payload: { "target_path": string, "source_path": string, "content": string, "script_command": string, "script_path": string })
              - agent: "coding" -> task_type: "implement_logic" | "refactor" | "fix_bug" (payload: { "instruction": string, "context": string })
              - agent: "github" -> task_type: "monitor_repo" | "check_pr" | "check_ci"
              - agent: "news" -> task_type: "get_digest"
              - agent: "scheduler" -> task_type: "schedule_prompt" | "sync_calendar"
              - agent: "health" -> task_type: "check_system_health" | "check_user_wellbeing"
              - agent: "google-workspace" -> task_type: "create_doc" | "search_drive" (payload: { "title": string, "content": string, "query": string })
              - agent: "chaos" -> task_type: "adventurous"
              - agent: "deploy" -> task_type: "git_commit_push" | "build_application"

              DYNAMIC CONNECTORS (MCP):
              ${connectorDescriptions || "No external connectors configured."}

              Output strictly valid JSON: { "subtasks": [ { "agent": "...", "task_type": "...", "payload": {...}, "priority": "high|normal|low" } ] }`
          });

          const response = await model.generateContent(prompt);
          const text = response.response.text();
          const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
          subTasks = parsed.subtasks;
        } catch (e: any) {
          const isTransient = e.message?.includes('429') || 
                              e.message?.includes('quota') || 
                              e.message?.includes('503') || 
                              e.message?.includes('Service Unavailable') ||
                              e.message?.includes('high demand');

          if (isTransient && retryCount < maxRetries) {
            const nextModel = this.modelRotator.rotate();
            this.logger.warn(`Transient error for ${modelId} (${e.message}). Rotating to ${nextModel}...`);
            return this.orchestrateTask(sessionId, prompt, retryCount + 1);
          }
          this.logger.error(`Gemini decomposition failed: ${e.message}`);
        }
    }

    if (!subTasks || subTasks.length === 0) {
      this.logger.warn("No subtasks generated.");
      return { status: "error", message: "Failed to decompose task." };
    }

    let accumulatedContext = "";

    // Store subtasks in database
    for (const task of subTasks) {
      await this.prismaRetry(() => this.prisma.task.create({
        data: {
          sessionId,
          agentName: task.agent,
          taskType: task.task_type,
          status: 'pending',
          payload: JSON.stringify(task.payload)
        }
      }));
    }

    // SEQUENTIAL WORKFLOW EXECUTION
    for (const task of subTasks) {
      this.logger.log(`Dispatching ${task.task_type} to ${task.agent}`);
      const enhancedPayload = {
        ...task.payload,
        context: task.payload.context ? `${task.payload.context}\n\n[PREVIOUS_CONTEXT]: ${accumulatedContext}` : accumulatedContext
      };

      this.emitEvent(sessionId, {
        agent_name: 'orchestrator',
        type: 'update',
        content: `Step ${subTasks.indexOf(task) + 1}: Dispatching ${task.task_type} to ${task.agent.toUpperCase()}...`,
        timestamp: new Date().toISOString()
      });

      const queue = this.queues[task.agent];
      const taskId = uuidv4();
      const taskRecord = { taskId, agent: task.agent, taskType: task.task_type, status: 'running', timestamp: new Date().toISOString() };
      await this.redis.hset(`orch:history:${sessionId}`, taskId, JSON.stringify(taskRecord));

      try {
        let result: any;

        if (queue) {
          // Standard Internal Queue (Skill)
          const message: AgentMessage = {
            message_id: uuidv4(),
            session_id: sessionId,
            from_agent: 'orchestrator',
            to_agent: task.agent,
            task_type: task.task_type,
            payload: enhancedPayload,
            priority: task.priority || 'normal',
            timestamp: new Date().toISOString()
          };

          const job = await queue.add('task', message);
          result = await job.waitUntilFinished(this.queueEvents[task.agent]);
        } else if (task.agent === 'google-workspace') {
          // Special Internal Agent (HTTP to Email Service on port 3003)
          const endpoint = `http://localhost:3003/agents/google-workspace/${task.task_type.replace('_', '-')}`;
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(task.payload)
          });
          result = await res.json();
        } else {
          // Check if it's a Dynamic MCP Connector
          const connector = (this.cachedConfig?.connectors || []).find((c: any) => c.name === task.agent);
          if (connector) {
            result = await this.dispatchToMCP(connector, task, sessionId);
          } else {
            this.logger.error(`No agent or connector found for: ${task.agent}`);
            throw new Error(`Orchestration Error: Agent/Connector "${task.agent}" is offline or undefined.`);
          }
        }

        const completedRecord = { ...taskRecord, status: 'complete', result: result?.synthesis || result?.result || result };
        await this.redis.hset(`orch:history:${sessionId}`, taskId, JSON.stringify(completedRecord));

        const resultText = result?.synthesis || result?.result || (typeof result === 'string' ? result : JSON.stringify(result));
        if (resultText) {
          accumulatedContext += `\n[From ${task.agent}]: ${resultText}`;
        }

        await this.prisma.task.updateMany({
          where: { sessionId, agentName: task.agent, status: 'pending' },
          data: { status: 'complete', result: JSON.stringify(result) }
        });

      } catch (err) {
        this.logger.error(`Subtask ${task.task_type} failed: ${err.message}`);
        await this.redis.hset(`orch:history:${sessionId}`, taskId, JSON.stringify({ ...taskRecord, status: 'error', error: err.message }));
      }
    }

    // FINAL STEP: Summarize
    const sessionMeta = await this.summarizeSession(sessionId, prompt, accumulatedContext, subTasks.map(t => t.agent));
    await this.prismaRetry(() => (this.prisma.session as any).update({
      where: { id: sessionId },
      data: { title: sessionMeta.title, summary: sessionMeta.summary }
    }));

    return { task_id: uuidv4(), sessionId, subTasks };
  }

  private async summarizeSession(sessionId: string, originalPrompt: string, context: string, agents: string[], retryCount = 0) {
    if (!this.gemini) return { title: "New Session", summary: originalPrompt, date: new Date().toLocaleDateString(), agents };
    const modelId = this.modelRotator.getCurrentModel();
    const maxRetries = this.modelRotator.getAvailableModels().length;

    try {
      const model = this.gemini.getGenerativeModel({ model: modelId });
      const prompt = `Summarize this AI agent session into a short title and 1-sentence description.
      Original: ${originalPrompt}
      Findings: ${context}
      Output JSON: { "title": "...", "summary": "..." }`;

      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());

      return { id: sessionId, title: parsed.title, summary: parsed.summary, date: new Date().toISOString(), agents } as any;
    } catch (e: any) {
      const isTransient = e.message?.includes('429') || 
                          e.message?.includes('quota') || 
                          e.message?.includes('503') || 
                          e.message?.includes('Service Unavailable') ||
                          e.message?.includes('high demand');

      if (isTransient && retryCount < maxRetries) {
        this.modelRotator.rotate();
        return this.summarizeSession(sessionId, originalPrompt, context, agents, retryCount + 1);
      }
      return { id: sessionId, title: "Automated Session", summary: originalPrompt, date: new Date().toISOString(), agents } as any;
    }
  }

  async getSessionHistory(limit = 6, offset = 0): Promise<SessionSummary[]> {
    const sessions = await this.prisma.session.findMany({
      take: Number(limit),
      skip: Number(offset),
      include: { tasks: true },
      orderBy: { createdAt: 'desc' }
    });

    return sessions.map(s => ({
      id: s.id,
      title: s.title || "Untitled Session",
      summary: (s as any).summary || (s.tasks[0]?.result ? JSON.parse(s.tasks[0].result).synthesis?.substring(0, 100) : "No summary available"),
      date: s.createdAt.toISOString().split('T')[0],
      agents: Array.from(new Set(s.tasks.map(t => t.agentName)))
    }));
  }

  async getSession(id: string) {
    return this.prisma.session.findUnique({
      where: { id },
      include: { 
        tasks: { orderBy: { createdAt: 'asc' } },
        events: { orderBy: { timestamp: 'asc' } }
      }
    });
  }

  async getSessionTasks(sessionId: string) {
    return this.prisma.task.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' }
    });
  }

  async getSessionActivityHistory(sessionId: string) {
    return this.prisma.activityEvent.findMany({
      where: { sessionId },
      orderBy: { timestamp: 'asc' }
    });
  }
}
