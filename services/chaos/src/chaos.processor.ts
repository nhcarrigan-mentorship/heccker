import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Redis from 'ioredis';
import { AgentMessage, ActivityEvent } from './types';

@Processor('chaos')
export class ChaosProcessor extends WorkerHost {
  private readonly logger = new Logger(ChaosProcessor.name);
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
    this.logger.log(`Processing chaos task for session ${session_id}`);

    this.emitEvent(session_id, {
      agent_name: 'chaos',
      type: 'update',
      content: `The Chaos Agent has awoken. Analyzing intent...`,
      timestamp: new Date().toISOString()
    });

    try {
      const prompt = payload.prompt || "No prompt provided. Initiating spontaneous entropy.";
      let creativeOutput = "A swirling void of unpredictability.";

      const GEMINI_MODELS = [
        "gemini-2.0-flash",
        "gemini-2.5-flash-lite",
        "gemini-3.1-flash-lite-preview",
        "gemini-flash-latest"
      ];
      const modelId = GEMINI_MODELS[Math.floor(Math.random() * GEMINI_MODELS.length)];

      if (this.gemini) {
        this.emitEvent(session_id, {
          agent_name: 'chaos',
          type: 'update',
          content: `Consulting Gemini Cluster (${modelId}) for an unorthodox perspective...`,
          timestamp: new Date().toISOString()
        });

        const model = this.gemini.getGenerativeModel({ model: modelId, systemInstruction: "You are the Concaretti Chaos Agent. You provide wild, highly creative, unorthodox, slightly esoteric, and surprising perspectives. Do not be a helpful assistant. Be a rogue thinker. Keep it under 3 paragraphs." });
        const result = await model.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 1.0, maxOutputTokens: 1500 } });
        creativeOutput = result.response.text();
      }

      // 2. Visual manifestation via Pollinations.ai (Free, no-auth)
      const encodedPrompt = encodeURIComponent(`surreal, high fashion, cinematic, ${prompt}`);
      const imageUrl = `https://pollinations.ai/p/${encodedPrompt}?width=1024&height=1024&nologo=true&model=flux`;

      this.emitEvent(session_id, {
        agent_name: 'chaos',
        type: 'update',
        content: `Visual manifestation synchronized via Pollinations.ai. Manifesting reality...`,
        timestamp: new Date().toISOString()
      });

      this.emitEvent(session_id, {
        agent_name: 'chaos',
        type: 'final',
        content: `${creativeOutput}\n\n![Generated Manifestation](${imageUrl})`,
        timestamp: new Date().toISOString()
      });

      return { success: true, text: creativeOutput, image: imageUrl };

    } catch (e: any) {
      this.logger.error(e);
      this.emitEvent(session_id, {
        agent_name: 'chaos',
        type: 'error',
        content: `Chaos Error: The void pushed back too hard. ${e.message}`,
        timestamp: new Date().toISOString()
      });
      throw e;
    }
  }
}
