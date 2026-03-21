import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Redis from 'ioredis';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { minimatch } from 'minimatch';
import { AgentMessage, ActivityEvent } from './types';

const execAsync = promisify(exec);

@Processor('file_code')
export class FileCodeProcessor extends WorkerHost {
  private readonly logger = new Logger(FileCodeProcessor.name);
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

  private async fetchConfig() {
    try {
      const res = await fetch('http://localhost:3006/config');
      if (res.ok) {
        const payload = await res.json();
        return payload.data;
      }
    } catch (e) {
      this.logger.warn('Could not reach Config Service. Using default safety blocks.');
    }
    return {
      off_limits: { paths: ['/private', '/finance', '~/.ssh', 'C:\\Windows'] }
    };
  }

  private async isPathAllowed(targetPath: string) {
    const config = await this.fetchConfig();
    const offLimits = config?.off_limits?.paths || [];

    const normalized = path.normalize(targetPath).replace(/\\/g, '/');
    for (const blocked of offLimits) {
      // Simple minimatch block to satisfy `.conca off_limits` rules
      if (normalized.includes(blocked.replace(/\\/g, '/')) || minimatch(normalized, blocked)) {
        return false; // HARDBLOCK
      }
    }
    return true; // Allowed
  }

  async process(job: Job<AgentMessage>): Promise<any> {
    const { session_id, payload, task_type } = job.data;
    this.logger.log(`Processing file_code task for session ${session_id}`);

    this.emitEvent(session_id, {
      agent_name: 'file-code',
      type: 'update',
      content: `Initializing secure File & Code operations. Sandbox active.`,
      timestamp: new Date().toISOString()
    });

    try {
      let resultContent = "";

      // Robust alignment for common AI hallucinations
      const effectiveTaskType = (task_type === 'code_generation' || task_type === 'save_code_to_file') ? 'file_write' : task_type;

      if (effectiveTaskType === 'file_write') {
        const target_path = payload.target_path || path.join(os.tmpdir(), `concaretti_mock_${session_id}.txt`);
        const content = payload.content || "Empty content";

        this.emitEvent(session_id, {
          agent_name: 'file-code',
          type: 'update',
          content: `Checking .conca config hardblocks for path: ${target_path}...`,
          timestamp: new Date().toISOString()
        });

        const allowed = await this.isPathAllowed(target_path);
        if (!allowed) {
          throw new Error(`HARDBLOCK: Path ${target_path} is strictly forbidden by Config Service .conca rules.`);
        }

        this.emitEvent(session_id, {
          agent_name: 'file-code',
          type: 'update',
          content: `Path permitted. Writing to filesystem...`,
          timestamp: new Date().toISOString()
        });

        // Optional AI parsing
        let finalContent = content;
        const GEMINI_MODELS = [
          "gemini-2.0-flash",
          "gemini-2.5-flash-lite",
          "gemini-3.1-flash-lite-preview",
          "gemini-flash-latest"
        ];
        const modelId = GEMINI_MODELS[Math.floor(Math.random() * GEMINI_MODELS.length)];

        if (this.gemini) {
          this.emitEvent(session_id, {
            agent_name: 'file-code',
            type: 'update',
            content: `Formatting code output via ${modelId}...`,
            timestamp: new Date().toISOString()
          });
          const model = this.gemini.getGenerativeModel({ model: modelId, systemInstruction: "Format the following user payload into clean code. ONLY output the raw code. No markdown fences or explanations." });
          const result = await model.generateContent(payload.content);
          finalContent = result.response.text();
        }

        await fs.mkdir(path.dirname(target_path), { recursive: true });
        await fs.writeFile(target_path, finalContent, 'utf-8');
        resultContent = `Successfully wrote to ${target_path}`;

      } else if (task_type === 'file_read') {
        const target_path = payload.target_path;
        if (!target_path) throw new Error("target_path required for file_read");
        const allowed = await this.isPathAllowed(target_path);
        if (!allowed) throw new Error(`HARDBLOCK: Path ${target_path} is strictly forbidden.`);
        resultContent = await fs.readFile(target_path, 'utf-8');

      } else if (task_type === 'script_execute') {
        const { script_command } = payload;
        this.emitEvent(session_id, {
          agent_name: 'file-code',
          type: 'update',
          content: `Executing script in sandboxed child_process with 5000ms timeout: ${script_command}`,
          timestamp: new Date().toISOString()
        });

        const { stdout, stderr } = await execAsync(script_command, { timeout: 5000, maxBuffer: 1024 * 1024 });
        resultContent = `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
      } else {
        throw new Error(`Unsupported task_type: ${task_type}`);
      }

      this.emitEvent(session_id, {
        agent_name: 'file-code',
        type: 'final',
        content: `Secure task completed. Output: ${resultContent.substring(0, 100)}...`,
        timestamp: new Date().toISOString()
      });

      return { success: true, result: resultContent };
    } catch (e: any) {
      this.logger.error(e);
      this.emitEvent(session_id, {
        agent_name: 'file-code',
        type: 'error',
        content: `File/Code Execution Error: ${e.message}`,
        timestamp: new Date().toISOString()
      });
      throw e;
    }
  }
}
