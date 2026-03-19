import { Controller, Get, Put, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ConfigService } from './config.service';

@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getConfig() {
    return {
      success: true,
      data: this.configService.getCurrentConfig()
    };
  }

  @Put()
  updateConfig(@Body('conca_yaml') concaYaml: string) {
    if (!concaYaml) {
      return { success: false, error: { code: 'INVALID_CONCA', message: 'Missing conca_yaml' } };
    }
    const result = this.configService.saveConfig(concaYaml);
    return {
      success: true,
      data: { valid: true, parsed: result.parsed }
    };
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  validateConfig(@Body('conca_yaml') concaYaml: string) {
    if (!concaYaml) {
      return { success: false, error: { code: 'INVALID_CONCA', message: 'Missing conca_yaml' } };
    }
    const result = this.configService.validateConca(concaYaml);
    return {
      success: true,
      data: result
    };
  }
}
