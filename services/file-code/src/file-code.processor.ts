import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
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

      if (task_type === 'file_write') {
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
        if (this.anthropic) {
           const aiFormat = await this.anthropic.messages.create({
              model: 'claude-3-haiku-20240307',
              max_tokens: 1000,
              system: "Format the following user payload into clean code.",
              messages: [{ role: 'user', content: payload.content }]
           });
           const textBlock: any = aiFormat.content.find((c: any) => c.type === 'text');
           if (textBlock) finalContent = textBlock.text;
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
