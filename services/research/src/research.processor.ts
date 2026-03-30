import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Redis from 'ioredis';
import { AgentMessage, ActivityEvent } from '@concaretti/shared-types';
import { tavily } from '@tavily/core';
import { ModelRotator } from './utils/ModelRotator';

@Processor('research')
export class ResearchProcessor extends WorkerHost {
  private readonly logger = new Logger(ResearchProcessor.name);
  private gemini: GoogleGenerativeAI | null = null;
  private tvly: ReturnType<typeof tavily> | null = null;
  private redis: Redis;
  private modelRotator = new ModelRotator();

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

  async process(job: Job<AgentMessage>, _token?: string): Promise<any> {
    return this.processWithRetry(job, 0);
  }

  private async processWithRetry(job: Job<AgentMessage>, retryCount: number): Promise<any> {
    const { session_id, payload } = job.data;
    const modelId = this.modelRotator.getCurrentModel();
    const maxRetries = this.modelRotator.getAvailableModels().length;

    this.logger.log(`Processing research task for session ${session_id} (Model: ${modelId})`);

    this.emitEvent(session_id, {
      agent_name: 'research',
      type: 'update',
      content: `Started web search for: "${payload.query}"`,
      timestamp: new Date().toISOString()
    });

    try {
      const task_type = job.data.task_type || 'web_search';
      const query = payload.query || payload.url;
      if (!query) {
        throw new Error("No specific query or URL provided for research task. Aborting to prevent hallucination.");
      }
      const isDeep = task_type === 'deep_research';
      let searchResults = '';
      let sourceCount = 1;

      if (this.tvly) {
        this.emitEvent(session_id, {
          agent_name: 'research',
          type: 'update',
          content: `${isDeep ? 'Initiating multi-wave Deep Research' : 'Searching the live web'} via Tavily for: "${query}"`,
          timestamp: new Date().toISOString()
        });
        const tvlyRes = await this.tvly.search(query, {
          searchDepth: isDeep ? "advanced" : "basic",
          maxResults: isDeep ? 10 : 5
        });
        searchResults = tvlyRes.results.map((r: any) => `${r.title}: ${r.content}`).join('\n') || 'No results found.';
        sourceCount = tvlyRes.results.length || 0;
      }

      // 2. Synthesis
      let synthesis = "";
      if (this.gemini) {
        try {
          const instruction = isDeep
            ? "You are the Concaretti Deep Research Agent. Provide a comprehensive, multi-paragraph analysis based on the provided search results."
            : "You are the Concaretti Research Agent. Synthesize the provided search results into a concise summary.";

          const model = this.gemini.getGenerativeModel({ model: modelId, systemInstruction: instruction });
          const result = await model.generateContent(`Query: ${query}\nResults:\n${searchResults}`);
          synthesis = result.response.text();
        } catch (e: any) {
          if ((e.message?.includes('429') || e.message?.includes('quota')) && retryCount < maxRetries) {
            this.modelRotator.rotate();
            return this.processWithRetry(job, retryCount + 1);
          }
          throw e;
        }
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
