import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import Redis from 'ioredis';
import Replicate from 'replicate';
import { AgentMessage, ActivityEvent } from './types';

@Processor('chaos')
export class ChaosProcessor extends WorkerHost {
  private readonly logger = new Logger(ChaosProcessor.name);
  private anthropic: Anthropic | null = null;
  private replicate: Replicate | null = null;
  private redis: Redis;

  constructor() {
    super();
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    if (process.env.REPLICATE_API_TOKEN) {
      this.replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
    }
    this.redis = new Redis({ host: 'localhost', port: 6379 });
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
      
      if (this.anthropic) {
         this.emitEvent(session_id, {
           agent_name: 'chaos',
           type: 'update',
           content: `Consulting Claude-3-Haiku (Entropy Mode) for an unorthodox perspective...`,
           timestamp: new Date().toISOString()
         });

         const claudeRes = await this.anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 1500,
            temperature: 1.0, // High temperature for chaos
            system: "You are the Concaretti Chaos Agent. You provide wild, highly creative, unorthodox, slightly esoteric, and surprising perspectives. Do not be a helpful assistant. Be a rogue thinker. Keep it under 3 paragraphs.",
            messages: [{ role: 'user', content: prompt }]
          });
          const textBlock: any = claudeRes.content.find((c: any) => c.type === 'text');
          if (textBlock) creativeOutput = textBlock.text;
      }

      if (this.replicate) {
         this.emitEvent(session_id, {
           agent_name: 'chaos',
           type: 'update',
           content: `Channeling creative output into visual space via Replicate...`,
           timestamp: new Date().toISOString()
         });

         // Example using a fast stable diffusion model like SDXL
         const imageOut = await this.replicate.run(
           "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
           {
             input: {
               prompt: `Editorial, high fashion, surreal interpretation of: ${prompt.substring(0, 100)}`,
               num_outputs: 1
             }
           }
         ) as any;
         
         const imageUrl = Array.isArray(imageOut) ? imageOut[0] : imageOut;
         
         this.emitEvent(session_id, {
           agent_name: 'chaos',
           type: 'final',
           content: `${creativeOutput}\n\n[Manifestation generated: ${imageUrl}]`,
           timestamp: new Date().toISOString()
         });

         return { success: true, text: creativeOutput, image: imageUrl };
      } else {
        // Just emit Claude output
        this.emitEvent(session_id, {
          agent_name: 'chaos',
          type: 'final',
          content: creativeOutput,
          timestamp: new Date().toISOString()
        });

        return { success: true, text: creativeOutput };
      }
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
