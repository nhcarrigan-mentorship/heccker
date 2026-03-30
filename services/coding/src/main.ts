import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.CODING_PORT || 3013;
  await app.listen(port);
  console.log(`Coding Agent is active on port ${port}`);
}
bootstrap();
