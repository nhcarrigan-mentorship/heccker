import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ChaosProcessor } from './chaos.processor';

@Module({
  imports: [
    BullModule.forRoot({
      connection: { host: 'localhost', port: 6379 },
    }),
    BullModule.registerQueue({
      name: 'chaos',
    }),
  ],
  providers: [ChaosProcessor],
})
export class AppModule {}
