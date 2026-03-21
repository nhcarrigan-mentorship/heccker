import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Redis from 'ioredis';
import { google } from 'googleapis';
import { AgentMessage, ActivityEvent } from './types';

@Processor('email')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
  private gemini: GoogleGenerativeAI | null = null;
  private redis: Redis;

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

      } else {
        // Default to Draft mode
        this.emitEvent(session_id, {
          agent_name: 'email',
          type: 'update',
          content: isOauthConfigured ? `Connected via OAuth2. Preparing draft...` : `No OAuth. Mocking draft...`,
          timestamp: new Date().toISOString()
        });

        let draftContent = "Mock drafted email regarding: " + JSON.stringify(payload);
        const GEMINI_MODELS = [
          "gemini-2.0-flash",
          "gemini-2.5-flash-lite",
          "gemini-3.1-flash-lite-preview",
          "gemini-flash-latest"
        ];
        const modelId = GEMINI_MODELS[Math.floor(Math.random() * GEMINI_MODELS.length)];

        if (this.gemini) {
          this.emitEvent(session_id, {
            agent_name: 'email',
            type: 'update',
            content: `Drafting reply using ${modelId}...`,
            timestamp: new Date().toISOString()
          });

          const model = this.gemini.getGenerativeModel({ model: modelId, systemInstruction: "You are the Concaretti Email Agent. Draft a professional, concise email utilizing the following context." });
          const result = await model.generateContent(`Context: ${JSON.stringify(payload)}`);
          draftContent = result.response.text();
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
    ].join('\n');

    return Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
}
