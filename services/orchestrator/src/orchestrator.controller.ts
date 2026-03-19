import { Controller, Post, Body } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';

@Controller('agents')
export class OrchestratorController {
  constructor(private readonly orchestratorService: OrchestratorService) {}

  @Post('orchestrate')
  async orchestrate(@Body() body: { session_id: string, prompt: string, conca_override?: any }) {
    const result = await this.orchestratorService.orchestrateTask(
      body.session_id, 
      body.prompt, 
      body.conca_override
    );
    
    return {
      success: true,
      data: result
    };
  }
}
