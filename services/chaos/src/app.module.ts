import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ChaosProcessor } from './chaos.processor';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    BullModule.registerQueue({
      name: 'chaos',
    }),
  ],
  providers: [ChaosProcessor],
})
export class AppModule {}
