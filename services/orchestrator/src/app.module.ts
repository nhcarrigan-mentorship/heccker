import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { OrchestratorController } from './orchestrator.controller';
import { SessionController } from './session.controller';
import { OrchestratorService } from './orchestrator.service';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    BullModule.registerQueue(
      { name: 'research' },
      { name: 'email' },
      { name: 'file_code' },
      { name: 'chaos' },
      { name: 'github' },
      { name: 'news' },
      { name: 'scheduler' },
    ),
  ],
  controllers: [OrchestratorController, SessionController],
  providers: [OrchestratorService],
})
export class AppModule {}
