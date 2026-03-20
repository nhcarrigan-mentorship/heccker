import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ResearchProcessor } from './research.processor';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: 'localhost',
        port: 6379,
      },
    }),
    BullModule.registerQueue({
      name: 'research',
    }),
  ],
  controllers: [],
  providers: [ResearchProcessor],
})
export class AppModule {}
