import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { OrchestratorController } from './orchestrator.controller';
import { SessionController } from './session.controller';
import { OrchestratorService } from './orchestrator.service';
import { PrismaService } from './prisma.service';

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
      { name: 'file-code' },
      { name: 'chaos' },
      { name: 'github' },
      { name: 'news' },
      { name: 'scheduler' },
      { name: 'health' },
      { name: 'coding' },
      { name: 'deploy' },
    ),
  ],
  controllers: [OrchestratorController, SessionController],
  providers: [OrchestratorService, PrismaService],
})
export class AppModule {}
