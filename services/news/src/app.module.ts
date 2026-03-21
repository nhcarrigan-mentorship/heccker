import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NewsProcessor } from './news.processor';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    BullModule.registerQueue({
      name: 'news',
    }),
  ],
  providers: [NewsProcessor],
})
export class AppModule {}
