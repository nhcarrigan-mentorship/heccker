import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerProcessor } from './scheduler.processor';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    // The scheduler can add jobs to ANY agent queue
    BullModule.registerQueue(
      { name: 'orchestrator' },
      { name: 'github' },
      { name: 'news' },
      { name: 'scheduler' }
    ),
  ],
  providers: [SchedulerProcessor],
})
export class AppModule {}
