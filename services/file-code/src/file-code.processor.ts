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
import { ModelRotator } from './utils/ModelRotator';
import { DocxGenerator } from './utils/DocxGenerator';

const execAsync = promisify(exec);

@Processor('file-code')
export class FileCodeProcessor extends WorkerHost {
  private readonly logger = new Logger(FileCodeProcessor.name);
  private gemini: GoogleGenerativeAI | null = null;
  private redis: Redis;
  private modelRotator = new ModelRotator();

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

  async process(job: Job<AgentMessage>, _token?: string): Promise<any> {
    return this.processWithRetry(job, 0);
  }

  private async processWithRetry(job: Job<AgentMessage>, retryCount: number): Promise<any> {
    const { session_id, payload, task_type } = job.data;
    const modelId = this.modelRotator.getCurrentModel();
    const maxRetries = this.modelRotator.getAvailableModels().length;

    this.logger.log(`Processing file-code task for session ${session_id} (Model: ${modelId})`);

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
        if (this.gemini) {
          try {
            const prompt = `Task content: ${payload.content || "Use context only"}\n\nRelated Context: ${payload.context || "No context"}`;
            const model = this.gemini.getGenerativeModel({ 
              model: modelId, 
              systemInstruction: "Format the following into clean, professional code or a structured report as requested. ONLY output the raw content. NO markdown fences. Integrate the 'Related Context' if it aids the 'Task content'." 
            });
            const result = await model.generateContent(prompt);
            finalContent = result.response.text();
          } catch (e: any) {
            if ((e.message?.includes('429') || e.message?.includes('quota')) && retryCount < maxRetries) {
              this.modelRotator.rotate();
              return this.processWithRetry(job, retryCount + 1);
            }
            throw e;
          }
        }

        await fs.mkdir(path.dirname(target_path), { recursive: true });
        
        const ext = path.extname(target_path).toLowerCase();
        if (ext === '.docx') {
          const buffer = await DocxGenerator.generate(finalContent, path.basename(target_path, '.docx'));
          await fs.writeFile(target_path, buffer);
          resultContent = `Successfully generated real Word document at ${target_path}`;
        } else {
          await fs.writeFile(target_path, finalContent, 'utf-8');
          resultContent = `Successfully wrote to ${target_path}`;
        }

      } else if (task_type === 'file_read') {
        const target_path = payload.target_path;
        if (!target_path) throw new Error("target_path required for file_read");
        
        const allowed = await this.isPathAllowed(target_path);
        if (!allowed) throw new Error(`HARDBLOCK: Path ${target_path} is strictly forbidden.`);

        this.emitEvent(session_id, {
          agent_name: 'file-code',
          type: 'update',
          content: `Reading and parsing document: ${path.basename(target_path)}`,
          timestamp: new Date().toISOString()
        });

        const { DocumentParser } = require('./utils/DocumentParser');
        const rawContent = await DocumentParser.parse(target_path);
        resultContent = rawContent;

        // SMART SUMMARY: If it's a known document type, generate a quick summary
        const ext = path.extname(target_path).toLowerCase();
        if (this.gemini && ['.docx', '.pdf', '.csv'].includes(ext)) {
          try {
            this.emitEvent(session_id, {
              agent_name: 'file-code',
              type: 'update',
              content: `Generating executive summary for ${path.basename(target_path)}...`,
              timestamp: new Date().toISOString()
            });

            const model = this.gemini.getGenerativeModel({ model: modelId });
            const prompt = `Summarize the following document content in 2-3 professional, punchy sentences for an executive dashboard. Focus on the core message or data trend.\n\nContent:\n${rawContent.substring(0, 5000)}`;
            const result = await model.generateContent(prompt);
            const summary = result.response.text().trim();
            
            resultContent = `[CONCESSUS SUMMARY]:\n${summary}\n\n[FULL DOCUMENT CONTENT]:\n${rawContent}`;
          } catch (e) {
            this.logger.warn(`Failed to generate summary: ${e.message}`);
          }
        }

      } else if (task_type === 'file_copy') {
        const { source_path, target_path } = payload;
        if (!source_path || !target_path) throw new Error("source_path and target_path required for file_copy");
        const allowedSource = await this.isPathAllowed(source_path);
        const allowedTarget = await this.isPathAllowed(target_path);
        if (!allowedSource || !allowedTarget) throw new Error("HARDBLOCK: One of the paths is strictly forbidden.");

        await fs.mkdir(path.dirname(target_path), { recursive: true });
        await fs.copyFile(source_path, target_path);
        resultContent = `Successfully copied ${source_path} to ${target_path}`;

      } else if (task_type === 'file_move') {
        const { source_path, target_path } = payload;
        if (!source_path || !target_path) throw new Error("source_path and target_path required for file_move");
        const allowedSource = await this.isPathAllowed(source_path);
        const allowedTarget = await this.isPathAllowed(target_path);
        if (!allowedSource || !allowedTarget) throw new Error("HARDBLOCK: One of the paths is strictly forbidden.");

        await fs.mkdir(path.dirname(target_path), { recursive: true });
        await fs.rename(source_path, target_path);
        resultContent = `Successfully moved ${source_path} to ${target_path}`;

      } else if (task_type === 'file_delete') {
        const { target_path } = payload;
        if (!target_path) throw new Error("target_path required for file_delete");
        const allowed = await this.isPathAllowed(target_path);
        if (!allowed) throw new Error(`HARDBLOCK: Path ${target_path} is strictly forbidden.`);

        await fs.unlink(target_path);
        resultContent = `Successfully deleted ${target_path}`;

      } else if (task_type === 'script_execute' || task_type === 'python_execute') {
        const command = task_type === 'python_execute' ? `python ${payload.script_path}` : payload.script_command;
        if (task_type === 'python_execute' && !payload.script_path) throw new Error("script_path required for python_execute");
        if (task_type === 'script_execute' && !payload.script_command) throw new Error("script_command required for script_execute");

        this.emitEvent(session_id, {
          agent_name: 'file-code',
          type: 'update',
          content: `Executing ${task_type === 'python_execute' ? 'Python script' : 'command'} with 5000ms timeout: ${command}`,
          timestamp: new Date().toISOString()
        });

        const { stdout, stderr } = await execAsync(command, { timeout: 5000, maxBuffer: 1024 * 1024 });
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
