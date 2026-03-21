import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('GitHubAgent');
  const port = process.env.GITHUB_PORT || 3008;
  await app.listen(port);
  logger.log(`GitHub Agent is active on port ${port}`);
}
bootstrap();
