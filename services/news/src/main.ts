import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('NewsAgent');
  const port = process.env.NEWS_PORT || 3009;
  await app.listen(port);
  logger.log(`News Agent is active on port ${port}`);
}
bootstrap();
