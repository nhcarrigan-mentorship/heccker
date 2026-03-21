import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import Redis from 'ioredis';
import Parser from 'rss-parser';

@Processor('news')
export class NewsProcessor extends WorkerHost {
  private readonly logger = new Logger(NewsProcessor.name);
  private redis: Redis;
  private parser: Parser;

  constructor() {
    super();
    this.parser = new Parser();
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });
  }

  private emitEvent(sessionId: string, event: any) {
    this.redis.publish('activity_events', JSON.stringify({ sessionId, event }));
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { session_id, payload, task_type } = job.data;
    this.logger.log(`Processing News task: ${task_type}`);

    this.emitEvent(session_id, {
      agent_name: 'news',
      type: 'update',
      content: `News Agent engaged. Digesting topic: ${payload.topic || 'General AI'}`,
      timestamp: new Date().toISOString()
    });

    try {
      // Mocking RSS sources for topics
      const feedUrl = payload.topic?.toLowerCase().includes('ai') 
        ? 'https://hnrss.org/frontpage?q=AI' 
        : 'https://hnrss.org/newest';

      const feed = await this.parser.parseURL(feedUrl);
      const resultText = feed.items.slice(0, 5).map((item: any) => `[${item.pubDate}] ${item.title} - ${item.link}`).join('\n');

      this.emitEvent(session_id, {
        agent_name: 'news',
        type: 'final',
        content: `News Digest Complete. Found ${feed.items.length} items.`,
        timestamp: new Date().toISOString()
      });

      return { success: true, result: resultText };

    } catch (e: any) {
      this.logger.error(e.message);
      this.emitEvent(session_id, {
        agent_name: 'news',
        type: 'error',
        content: `News Error: ${e.message}`,
        timestamp: new Date().toISOString()
      });
      throw e;
    }
  }
}
