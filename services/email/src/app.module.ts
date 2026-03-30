import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailProcessor } from './email.processor';
import { EmailController } from './email.controller';
import { GoogleWorkspaceController } from './google-workspace.controller';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    BullModule.registerQueue({
      name: 'email',
    }),
  ],
  controllers: [EmailController, GoogleWorkspaceController],
  providers: [EmailProcessor],
})
export class AppModule {}
