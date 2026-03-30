import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Redis from 'ioredis';
import { google } from 'googleapis';
import { AgentMessage, ActivityEvent } from './types';
import { ModelRotator } from './utils/ModelRotator';

@Processor('email')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
  private gemini: GoogleGenerativeAI | null = null;
  private redis: Redis;
  private modelRotator = new ModelRotator();

  constructor() {
    super();
    if (process.env.GEMINI_API_KEY) {
      this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });
  }

  private emitEvent(sessionId: string, event: ActivityEvent) {
    this.redis.publish('activity_events', JSON.stringify({ sessionId, event }));
  }

  async process(job: Job<AgentMessage>, _token?: string): Promise<any> {
    return this.processWithRetry(job, 0);
  }

  private async processWithRetry(job: Job<AgentMessage>, retryCount: number): Promise<any> {
    const { session_id, payload } = job.data;
    const modelId = this.modelRotator.getCurrentModel();
    const maxRetries = this.modelRotator.getAvailableModels().length;

    this.logger.log(`Processing email task for session ${session_id} (Model: ${modelId})`);

    this.emitEvent(session_id, {
      agent_name: 'email',
      type: 'update',
      content: `Connecting to Gmail API...`,
      timestamp: new Date().toISOString()
    });

    try {
      const task_type = job.data.task_type || 'draft_email';
      const isOauthConfigured = !!process.env.GOOGLE_CLIENT_ID;

      if (task_type === 'send_email') {
        const { recipient, subject, body } = payload;
        this.emitEvent(session_id, {
          agent_name: 'email',
          type: 'update',
          content: `Attempting to dispatch email to ${recipient}...`,
          timestamp: new Date().toISOString()
        });

        if (!process.env.GOOGLE_REFRESH_TOKEN) {
          throw new Error("GOOGLE_REFRESH_TOKEN is missing in .env. Cannot send real email.");
        }

        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        const rawMessage = this.createRawEmail(recipient, subject, body);

        await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: rawMessage },
        });

        this.emitEvent(session_id, {
          agent_name: 'email',
          type: 'final',
          content: `Email successfully sent to ${recipient}!`,
          timestamp: new Date().toISOString()
        });

        return { success: true, status: "sent" };

      } else if (task_type === 'search_emails') {
        const { query = "" } = payload;
        this.emitEvent(session_id, {
          agent_name: 'email',
          type: 'update',
          content: `Searching emails for query: "${query}"...`,
          timestamp: new Date().toISOString()
        });

        if (!process.env.GOOGLE_REFRESH_TOKEN) {
          throw new Error("GOOGLE_REFRESH_TOKEN is missing. Cannot search real emails.");
        }

        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        const response = await gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: 5,
        });

        const messages = response.data.messages || [];
        const results: any[] = [];
        for (const msg of messages) {
          if (!msg.id) continue;
          const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id as string });
          results.push({
            snippet: detail.data.snippet,
            date: detail.data.internalDate,
          });
        }

        this.emitEvent(session_id, {
          agent_name: 'email',
          type: 'final',
          content: `Found ${results.length} emails matching "${query}".`,
          timestamp: new Date().toISOString()
        });

        return { success: true, results };

      } else {
        // Default to Draft mode
        this.emitEvent(session_id, {
          agent_name: 'email',
          type: 'update',
          content: isOauthConfigured ? `Connected via OAuth2. Preparing draft...` : `No OAuth. Mocking draft...`,
          timestamp: new Date().toISOString()
        });

        let draftContent = "Mock drafted email regarding: " + JSON.stringify(payload);
        if (this.gemini) {
          try {
            this.logger.log(`Drafting reply via ${modelId}. Context length: ${JSON.stringify(payload).length}`);
            const model = this.gemini.getGenerativeModel({ 
              model: modelId, 
              systemInstruction: "You are the Concaretti Email Agent. Draft a professional, concise email. COMPULSORY: You MUST start the draft with 'To: [Recipient Email]' and 'Subject: [Subject]' on the first two lines, followed by a double newline and then the body. You MUST prioritize and utilize the information found in the '[PREVIOUS_CONTEXT]' or 'context' field of the payload to ensure the email is relevant to the session's research and previous actions." 
            });
            const result = await model.generateContent(`Payload data for drafting: ${JSON.stringify(payload)}`);
            draftContent = result.response.text();
          } catch (e: any) {
            if ((e.message?.includes('429') || e.message?.includes('quota')) && retryCount < maxRetries) {
              this.modelRotator.rotate();
              return this.processWithRetry(job, retryCount + 1);
            }
            throw e;
          }
        }

        this.emitEvent(session_id, {
          agent_name: 'email',
          type: 'final',
          content: `Draft complete. Waiting for user confirmation before sending. \n\n<Draft Preview>\n${draftContent}\n</Draft Preview>`,
          timestamp: new Date().toISOString()
        });

        return { success: true, draftContent, status: "awaiting_confirmation" };
      }
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

  private createRawEmail(to: string, subject: string, body: string): string {
    const message = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].join('\r\n');

    return Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
}
