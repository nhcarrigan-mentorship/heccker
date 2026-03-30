import { Controller, Post, Get, Body, Query, Param } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';

@Controller('agents')
export class OrchestratorController {
  constructor(private readonly orchestratorService: OrchestratorService) {}

  @Get('history')
  async getHistory(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    return this.orchestratorService.getSessionHistory(
      limit ? parseInt(limit, 10) : 6,
      offset ? parseInt(offset, 10) : 0
    );
  }

  @Get('sessions/:id')
  async getSession(@Param('id') id: string) {
    return this.orchestratorService.getSession(id);
  }

  @Get('sessions/:id/tasks')
  async getSessionTasks(@Param('id') id: string) {
    return this.orchestratorService.getSessionTasks(id);
  }

  @Get('sessions/:id/history')
  async getSessionHistoryData(@Param('id') id: string) {
    return this.orchestratorService.getSessionActivityHistory(id);
  }

  @Post('orchestrate')
  async orchestrate(@Body() body: { session_id: string, prompt: string, conca_override?: any }) {
    console.log(`[Orchestrator] Received request for session: ${body.session_id}`);
    const result = await this.orchestratorService.orchestrateTask(
      body.session_id, 
      body.prompt
    );
    console.log(`[Orchestrator] Task completed for session: ${body.session_id}`);
    
    return {
      success: true,
      data: result
    };
  }
}
