import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.DEPLOY_PORT || 3014;
  await app.listen(port);
  console.log(`Deploy Agent is active on port ${port}`);
}
bootstrap();
