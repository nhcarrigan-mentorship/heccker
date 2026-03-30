import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import * as os from 'os';
// @ts-ignore
import { AgentMessage, ActivityEvent } from '@concaretti/shared-types';

@Processor('health')
export class HealthProcessor extends WorkerHost {
  private readonly logger = new Logger(HealthProcessor.name);
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
    const { session_id, task_type } = job.data;
    this.logger.log(`Processing health task: ${task_type}`);

    try {
      if (task_type === 'check_system_health') {
        const cpuLoad = os.loadavg()[0];
        const freeMem = os.freemem() / (1024 * 1024 * 1024);
        const totalMem = os.totalmem() / (1024 * 1024 * 1024);
        const memUsage = ((totalMem - freeMem) / totalMem) * 100;

        const healthStatus = cpuLoad > 4 ? 'Warning: High Load' : 'Status: Optimal';
        const content = `System Metrics: CPU Load (1m): ${cpuLoad.toFixed(2)}, Memory: ${memUsage.toFixed(1)}% used. ${healthStatus}`;

        this.emitEvent(session_id, {
          agent_name: 'health',
          type: 'update',
          content,
          timestamp: new Date().toISOString()
        });

        return { success: true, result: content };
      } else if (task_type === 'check_user_wellbeing') {
        const content = "Wellness Check: You've been active for a while. Consider a 5-minute break to stay sharp! 🧘";
        this.emitEvent(session_id, {
          agent_name: 'health',
          type: 'update',
          content,
          timestamp: new Date().toISOString()
        });
        return { success: true, result: content };
      }

      return { success: false, error: 'Unknown health task type' };
    } catch (e: any) {
      this.logger.error(e);
      return { success: false, error: e.message };
    }
  }
}
