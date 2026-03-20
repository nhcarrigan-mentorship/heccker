import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import Redis from 'ioredis';
import { AgentMessage, ActivityEvent } from '@concaretti/shared-types';

@Processor('research')
export class ResearchProcessor extends WorkerHost {
  private readonly logger = new Logger(ResearchProcessor.name);
  private anthropic: Anthropic | null = null;
  private redis: Redis;

  constructor() {
    super();
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    this.redis = new Redis({ host: 'localhost', port: 6379 });
  }

  private emitEvent(sessionId: string, event: ActivityEvent) {
    this.redis.publish('activity_events', JSON.stringify({ sessionId, event }));
  }

  async process(job: Job<AgentMessage>): Promise<any> {
    const { session_id, payload } = job.data;
    this.logger.log(`Processing research task for session ${session_id}`);

    this.emitEvent(session_id, {
      agent_name: 'research',
      type: 'update',
      content: `Started web search for: "${payload.query}"`,
      timestamp: new Date().toISOString()
    });

    try {
      // 1. Wikipedia fetch
      const query = payload.query;
      const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json`);
      const data = await res.json();
      
      const searchResults = data.query?.search?.map((s: any) => s.snippet.replace(/<\/?[^>]+(>|$)/g, "")).join('\n') || 'No results found.';

      this.emitEvent(session_id, {
        agent_name: 'research',
        type: 'update',
        content: `Gathered search results from 1 sources. Synthesizing via Claude...`,
        timestamp: new Date().toISOString()
      });

      // 2. Claude synthesis
      let synthesis = "";
      if (this.anthropic) {
        const claudeRes = await this.anthropic.messages.create({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1000,
          system: "You are the Concaretti Research Agent. Synthesize the provided search results into a concise 2-sentence summary answering the user query. Do not include HTML tags.",
          messages: [{ role: 'user', content: `Query: ${query}\nResults:\n${searchResults}` }]
        });
        const textBlock: any = claudeRes.content.find((c: any) => c.type === 'text');
        if (textBlock) synthesis = textBlock.text;
      } else {
        synthesis = `Analyzed snippets for "${query}". Found roughly ${data.query?.search?.length || 0} top results. Context acquired.`;
      }

      // 3. Emit final result
      this.emitEvent(session_id, {
        agent_name: 'research',
        type: 'final',
        content: `Research Complete: ${synthesis}`,
        timestamp: new Date().toISOString()
      });
      
      return { success: true, synthesis };
    } catch (e: any) {
      this.logger.error(e);
      this.emitEvent(session_id, {
        agent_name: 'research',
        type: 'error',
        content: `Research Error: ${e.message}`,
        timestamp: new Date().toISOString()
      });
      throw e;
    }
  }
}
