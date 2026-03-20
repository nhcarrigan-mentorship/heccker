import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Anthropic from '@anthropic-ai/sdk';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';
import { AgentMessage, ActivityEvent } from '@concaretti/shared-types';

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private anthropic: Anthropic | null = null;
  private subRedis: Redis;

  constructor(
    @InjectQueue('research') private researchQueue: Queue,
    @InjectQueue('email') private emailQueue: Queue,
    @InjectQueue('file_code') private fileCodeQueue: Queue,
    @InjectQueue('chaos') private chaosQueue: Queue,
    private eventEmitter: EventEmitter2
  ) {
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    } else {
      this.logger.warn('No ANTHROPIC_API_KEY provided. Using mock classification logic for prototype fallback.');
    }

    // Subscribe to Redis pub sub for inter-agent events
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

  private emitEvent(sessionId: string, event: ActivityEvent) {
    this.eventEmitter.emit(`session.${sessionId}`, event);
  }

  async orchestrateTask(sessionId: string, prompt: string, concaOverride?: any) {
    this.logger.log(`Received task for session ${sessionId}: ${prompt}`);
    
    this.emitEvent(sessionId, {
      agent_name: 'orchestrator',
      type: 'update',
      content: `Prompt received. Decomposing task via ${this.anthropic ? 'Claude-3-Haiku' : 'heuristic matcher'}...`,
      timestamp: new Date().toISOString()
    });
    
    let subTasks: Array<{ agent: string, task_type: string, payload: any, priority: string }> = [];

    if (this.anthropic) {
      try {
        const response = await this.anthropic.messages.create({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1000,
          system: `You are the Concaretti Orchestrator. 
            Decompose the user's prompt into sub-tasks for these agents: research, email, file_code, chaos. 
            Output strictly valid JSON matching { "subtasks": [ { "agent": "...", "task_type": "...", "payload": {...}, "priority": "high|normal|low" } ] }`,
          messages: [{ role: 'user', content: prompt }]
        });
        
        let textBlock: any = response.content.find((c: any) => c.type === 'text');
        if (textBlock) {
          const parsed = JSON.parse(textBlock.text);
          subTasks = parsed.subtasks;
        }
      } catch (e: any) {
        this.logger.error(`Failed to parse Claude JSON, falling back. Error: ${e.message}`);
      }
    }

    if (!subTasks || subTasks.length === 0) {
       subTasks = this.mockDecompose(prompt);
    }

    const agentsInvoked = new Set<string>();

    for (const task of subTasks) {
      const message: AgentMessage = {
        message_id: uuidv4(),
        session_id: sessionId,
        from_agent: 'orchestrator',
        to_agent: task.agent as any,
        task_type: task.task_type,
        payload: task.payload,
        priority: task.priority as any,
        timestamp: new Date().toISOString()
      };

      agentsInvoked.add(task.agent);
      await this.dispatchToAgent(task.agent, message);
      
      this.emitEvent(sessionId, {
        agent_name: 'orchestrator',
        type: 'update',
        content: `Dispatched ${task.task_type} sub-task to ${task.agent.toUpperCase()} agent.`,
        timestamp: new Date().toISOString()
      });
    }

    return {
      task_id: uuidv4(),
      status: "dispatched",
      agents_invoked: Array.from(agentsInvoked)
    };
  }

  private mockDecompose(prompt: string) {
    const lprompt = prompt.toLowerCase();
    const tasks: Array<{ agent: string, task_type: string, payload: any, priority: string }> = [];
    if (lprompt.includes('research') || lprompt.includes('search')) {
      tasks.push({ agent: 'research', task_type: 'web_search', payload: { query: prompt }, priority: 'normal' });
    }
    if (lprompt.includes('email') || lprompt.includes('message')) {
      tasks.push({ agent: 'email', task_type: 'draft_email', payload: { context: prompt }, priority: 'high' });
    }
    if (lprompt.includes('file') || lprompt.includes('code') || lprompt.includes('script')) {
      tasks.push({ agent: 'file_code', task_type: 'file_write', payload: { content: prompt }, priority: 'normal' });
    }
    if (tasks.length === 0) {
      tasks.push({ agent: 'chaos', task_type: 'adventurous', payload: { prompt }, priority: 'low' });
    }
    return tasks;
  }

  private async dispatchToAgent(agent: string, message: AgentMessage) {
    this.logger.log(`Dispatching sub-task to ${agent} queue...`);
    switch(agent) {
      case 'research': await this.researchQueue.add('task', message); break;
      case 'email': await this.emailQueue.add('task', message); break;
      case 'file_code': await this.fileCodeQueue.add('task', message); break;
      case 'chaos': await this.chaosQueue.add('task', message); break;
      default: this.logger.warn(`Unknown agent ${agent}`);
    }
  }
}
