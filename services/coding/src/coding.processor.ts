import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Redis } from 'ioredis';
// @ts-ignore
import { AgentMessage, ActivityEvent } from '@concaretti/shared-types';
import { ModelRotator } from './utils/ModelRotator';

@Processor('coding')
export class CodingProcessor extends WorkerHost {
  private readonly logger = new Logger(CodingProcessor.name);
  private gemini: GoogleGenerativeAI;
  private redis: Redis;
  private modelRotator = new ModelRotator();

  constructor() {
    super();
    this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });
  }

  async process(job: Job<any, any, string>): Promise<any> {
    return this.processWithRetry(job, 0);
  }

  private async processWithRetry(job: Job<any, any, string>, retryCount: number): Promise<any> {
    const { session_id, task_type, payload } = job.data;
    const modelId = this.modelRotator.getCurrentModel();
    const maxRetries = this.modelRotator.getAvailableModels().length;

    this.logger.log(`Processing coding task: ${task_type} (Using ${modelId})`);

    try {
      const model = this.gemini.getGenerativeModel({
        model: modelId,
        systemInstruction: `You are a Coding Agent. 
        Your goal is to provide DIRECT, UTILITARIAN code output.
        - NO conversational filler.
        - NO markdown formatting like \`\`\`typescript.
        - Just the raw code or text requested.
        - Focus on stability and performance.`
      });

      const prompt = `Task: ${task_type}\nInstruction: ${payload.instruction}\nContext: ${payload.context}`;
      const result = await model.generateContent(prompt);
      const synthesis = result.response.text().trim();

      await this.redis.publish('activity_events', JSON.stringify({
        sessionId: session_id,
        event: {
          agent_name: 'coding',
          type: 'result',
          content: synthesis,
          timestamp: new Date().toISOString()
        }
      }));

      return { synthesis };
    } catch (e: any) {
      this.logger.error(`Coding Gemini Error: ${e.message}`);
      if ((e.message?.includes('429') || e.message?.includes('quota')) && retryCount < maxRetries) {
        const nextModel = this.modelRotator.rotate();
        this.logger.warn(`Quota exceeded. Rotating to ${nextModel}...`);
        return this.processWithRetry(job, retryCount + 1);
      }
      throw e;
    }
  }
}
