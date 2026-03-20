import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FileCodeProcessor } from './file-code.processor';

@Module({
  imports: [
    BullModule.forRoot({
      connection: { host: 'localhost', port: 6379 },
    }),
    BullModule.registerQueue({
      name: 'file_code',
    }),
  ],
  providers: [FileCodeProcessor],
})
export class AppModule {}
