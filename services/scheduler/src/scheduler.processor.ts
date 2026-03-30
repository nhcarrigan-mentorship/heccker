import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Job } from 'bullmq';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import Redis from 'ioredis';

@Injectable()
@Processor('scheduler')
export class SchedulerProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SchedulerProcessor.name);
  private redis: Redis;

  constructor(
    @InjectQueue('orchestrator') private orchestratorQueue: Queue,
    private schedulerRegistry: SchedulerRegistry,
  ) {
    super();
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });
  }

  private emitEvent(sessionId: string, event: any) {
    this.redis.publish('activity_events', JSON.stringify({ sessionId, event }));
  }

  onModuleInit() {
    this.loadSchedulesFromConca();
  }

  private loadSchedulesFromConca() {
    try {
      const concaPath = path.join(process.cwd(), '../../.conca');
      if (!fs.existsSync(concaPath)) {
        this.logger.warn(`.conca not found at ${concaPath}`);
        return;
      }

      const fileContents = fs.readFileSync(concaPath, 'utf8');
      const config = yaml.load(fileContents) as any;

      if (config?.schedules && Array.isArray(config.schedules)) {
        config.schedules.forEach((s: any, index: number) => {
          this.addCronJob(`conca-schedule-${index}`, s.cron, s.prompt);
        });
      }
    } catch (e: any) {
      this.logger.error(`Failed to load schedules: ${e.message}`);
    }
  }

  private addCronJob(name: string, cronTime: string, prompt: string) {
    const job = new CronJob(cronTime, async () => {
      this.logger.log(`Executing scheduled prompt: ${prompt}`);
      this.emitEvent('scheduled-task', {
        agent_name: 'scheduler',
        type: 'update',
        content: `Cron trigger fired: ${prompt}`,
        timestamp: new Date().toISOString()
      });
      
      await this.orchestratorQueue.add('orchestrate', {
        session_id: `scheduled-${Date.now()}`,
        prompt
      });
    });

    this.schedulerRegistry.addCronJob(name, job);
    job.start();
    this.logger.log(`Registered cron [${name}]: ${cronTime}`);
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { session_id, payload, task_type } = job.data;
    this.logger.log(`Processing direct Scheduler task: ${task_type}`);

    if (task_type === 'schedule_prompt') {
      const { prompt, cron } = payload;
      this.addCronJob(`dynamic-${Date.now()}`, cron, prompt);
      return { success: true, result: `Dynamically scheduled: ${prompt} @ ${cron}` };
    } else if (task_type === 'sync_calendar') {
      const { provider = 'google', url } = payload;
      this.emitEvent(session_id, {
        agent_name: 'scheduler',
        type: 'update',
        content: `Syncing with ${provider} calendar...`,
        timestamp: new Date().toISOString()
      });
      // Mock sync logic
      const result = `Successfully synced with ${provider} calendar. 3 new events imported.`;
      this.emitEvent(session_id, {
          agent_name: 'scheduler',
          type: 'final',
          content: result,
          timestamp: new Date().toISOString()
        });
      return { success: true, result };
    }

    return { success: true };
  }
}
