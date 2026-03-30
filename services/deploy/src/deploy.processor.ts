import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { exec } from 'child_process';
import { promisify } from 'util';
// @ts-ignore
import { AgentMessage, ActivityEvent } from '@concaretti/shared-types';

const execAsync = promisify(exec);

@Processor('deploy')
export class DeployProcessor extends WorkerHost {
  private readonly logger = new Logger(DeployProcessor.name);
  private redis: Redis;

  constructor() {
    super();
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });
  }

  private emitEvent(sessionId: string, event: ActivityEvent) {
    this.redis.publish('activity_events', JSON.stringify({ sessionId, event }));
  }

  async process(job: Job<AgentMessage>): Promise<any> {
    const { session_id, payload, task_type } = job.data;
    this.logger.log(`Processing deploy task: ${task_type}`);

    try {
      let result = "";
      if (task_type === 'git_commit_push') {
        const { message = "Deploy update", branch = "main" } = payload;
        this.emitEvent(session_id, {
          agent_name: 'deploy',
          type: 'update',
          content: `Committing and pushing to ${branch}...`,
          timestamp: new Date().toISOString()
        });
        const { stdout, stderr } = await execAsync(`git add . && git commit -m "${message}" && git push origin ${branch}`);
        result = `Git Output:\n${stdout}\n${stderr}`;
      } else if (task_type === 'build_application') {
        this.emitEvent(session_id, {
          agent_name: 'deploy',
          type: 'update',
          content: `Running production build...`,
          timestamp: new Date().toISOString()
        });
        const { stdout, stderr } = await execAsync(`yarn build`);
        result = `Build Output:\n${stdout}\n${stderr}`;
      } else {
        throw new Error(`Unsupported deploy task: ${task_type}`);
      }

      this.emitEvent(session_id, {
        agent_name: 'deploy',
        type: 'final',
        content: `Deployment task complete.`,
        timestamp: new Date().toISOString()
      });

      return { success: true, result };
    } catch (e: any) {
      this.logger.error(e);
      return { success: false, error: e.message };
    }
  }
}
