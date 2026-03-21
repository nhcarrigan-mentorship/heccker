import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('SchedulerAgent');
  const port = process.env.SCHEDULER_PORT || 3010;
  await app.listen(port);
  logger.log(`Scheduler Agent is active on port ${port}`);
}
bootstrap();
