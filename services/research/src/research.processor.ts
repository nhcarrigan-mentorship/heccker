import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Redis from 'ioredis';
import { AgentMessage, ActivityEvent } from '@concaretti/shared-types';
import { tavily } from '@tavily/core';

@Processor('research')
export class ResearchProcessor extends WorkerHost {
  private readonly logger = new Logger(ResearchProcessor.name);
  private gemini: GoogleGenerativeAI | null = null;
  private tvly: ReturnType<typeof tavily> | null = null;
  private redis: Redis;

  constructor() {
    super();
    if (process.env.GEMINI_API_KEY) {
      this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }
    if (process.env.TAVILY_API_KEY) {
      this.tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });
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
    this.logger.log(`Processing research task for session ${session_id}`);

    this.emitEvent(session_id, {
      agent_name: 'research',
      type: 'update',
      content: `Started web search for: "${payload.query}"`,
      timestamp: new Date().toISOString()
    });

    try {
      // 1. Web search (Tavily or Wikipedia fallback)
      const query = payload.query || "Concaretti AI system"; // Safety fallback
      let searchResults = '';
      let sourceCount = 1;

      if (this.tvly) {
        this.emitEvent(session_id, {
          agent_name: 'research',
          type: 'update',
          content: `Searching the live web via Tavily for: "${query}"`,
          timestamp: new Date().toISOString()
        });
        const tvlyRes = await this.tvly.search(query, { searchDepth: "basic", maxResults: 5 });
        searchResults = tvlyRes.results.map((r: any) => `${r.title}: ${r.content}`).join('\n') || 'No results found.';
        sourceCount = tvlyRes.results.length || 0;
      } else {
        this.emitEvent(session_id, {
          agent_name: 'research',
          type: 'update',
          content: `Tavily key missing. Falling back to Wikipedia for: "${query}"`,
          timestamp: new Date().toISOString()
        });
        const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json`);
        const data = await res.json();
        searchResults = data.query?.search?.map((s: any) => s.snippet.replace(/<\/?[^>]+(>|$)/g, "")).join('\n') || 'No results found.';
        sourceCount = data.query?.search?.length || 0;
      }

      const GEMINI_MODELS = [
        "gemini-2.0-flash",
        "gemini-2.5-flash-lite",
        "gemini-3.1-flash-lite-preview",
        "gemini-flash-latest"
      ];
      const modelId = GEMINI_MODELS[Math.floor(Math.random() * GEMINI_MODELS.length)];

      this.emitEvent(session_id, {
        agent_name: 'research',
        type: 'update',
        content: `Gathered search results from ${sourceCount} sources. Synthesizing via ${modelId}...`,
        timestamp: new Date().toISOString()
      });

      // 2. Synthesis
      let synthesis = "";
      if (this.gemini) {
        const model = this.gemini.getGenerativeModel({ model: modelId, systemInstruction: "You are the Concaretti Research Agent. Synthesize the provided search results into a concise 2-sentence summary answering the user query. Do not include HTML tags." });
        const result = await model.generateContent(`Query: ${query}\nResults:\n${searchResults}`);
        synthesis = result.response.text();
      } else {
        synthesis = `Analyzed snippets for "${query}". Found roughly ${sourceCount} top results. Context acquired.`;
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
