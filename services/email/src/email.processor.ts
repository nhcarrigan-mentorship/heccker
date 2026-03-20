import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import Redis from 'ioredis';
import { google } from 'googleapis';
import { AgentMessage, ActivityEvent } from './types';

@Processor('email')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
  private anthropic: Anthropic | null = null;
  private redis: Redis;

  constructor() {
    super();
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });
  }

  private emitEvent(sessionId: string, event: ActivityEvent) {
    this.redis.publish('activity_events', JSON.stringify({ sessionId, event }));
  }

  async process(job: Job<AgentMessage>): Promise<any> {
    const { session_id, payload } = job.data;
    this.logger.log(`Processing email task for session ${session_id}`);

    this.emitEvent(session_id, {
      agent_name: 'email',
      type: 'update',
      content: `Connecting to Gmail API...`,
      timestamp: new Date().toISOString()
    });

    try {
      // Mock OAuth check
      const isOauthConfigured = !!process.env.GMAIL_CLIENT_ID;
      
      this.emitEvent(session_id, {
        agent_name: 'email',
        type: 'update',
        content: isOauthConfigured ? `Connected via OAuth2.` : `No OAuth configured. Proceeding with drafted mock...`,
        timestamp: new Date().toISOString()
      });

      // Claude Draft
      let draftContent = "Mock drafted email regarding: " + JSON.stringify(payload);
      if (this.anthropic) {
         this.emitEvent(session_id, {
           agent_name: 'email',
           type: 'update',
           content: `Drafting reply using Claude...`,
           timestamp: new Date().toISOString()
         });

         const claudeRes = await this.anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 1000,
            system: "You are the Concaretti Email Agent. Draft a professional, concise email utilizing the following context.",
            messages: [{ role: 'user', content: `Context: ${JSON.stringify(payload)}` }]
          });
          const textBlock: any = claudeRes.content.find((c: any) => c.type === 'text');
          if (textBlock) draftContent = textBlock.text;
      } else {
        await new Promise(res => setTimeout(res, 1500)); // Simulate thinking
      }

      this.emitEvent(session_id, {
        agent_name: 'email',
        type: 'final',
        content: `Draft complete. Waiting for user confirmation before sending. \n\n<Draft Preview>\n${draftContent}\n</Draft Preview>`,
        timestamp: new Date().toISOString()
      });

      // Halts sequence before a secondary confirmation job could trigger send
      return { success: true, draftContent, status: "awaiting_confirmation" };
    } catch (e: any) {
      this.logger.error(e);
      this.emitEvent(session_id, {
        agent_name: 'email',
        type: 'error',
        content: `Email Error: ${e.message}`,
        timestamp: new Date().toISOString()
      });
      throw e;
    }
  }
}
