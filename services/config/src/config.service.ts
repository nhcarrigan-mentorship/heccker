import { Injectable, BadRequestException } from '@nestjs/common';
import * as yaml from 'js-yaml';

@Injectable()
export class ConfigService {
  private currentConfig: any = null;

  parseConca(yamlString: string): any {
    try {
      const parsed = yaml.load(yamlString);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error("Invalid .conca format");
      }
      return parsed;
    } catch (err: any) {
      throw new Error(`Failed to parse .conca: ${err.message}`);
    }
  }

  validateConca(yamlString: string) {
    try {
      const parsed = this.parseConca(yamlString);
      const errors: string[] = [];
      const warnings: string[] = [];

      if (!parsed.version) errors.push("Missing 'version' field");
      if (!parsed.agent_permissions) errors.push("Missing 'agent_permissions' block");
      
      if (parsed.rules && !parsed.rules.chaos_mode) {
        warnings.push("chaos_mode not set, defaulting to balanced");
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        parsed: errors.length === 0 ? parsed : null
      };
    } catch (e: any) {
      return { valid: false, errors: [e.message], warnings: [] };
    }
  }

  getCurrentConfig() {
    return this.currentConfig || this.getDefaultConfig();
  }

  saveConfig(yamlString: string) {
    const result = this.validateConca(yamlString);
    if (!result.valid) {
      throw new BadRequestException({ message: "Invalid .conca file", errors: result.errors });
    }
    this.currentConfig = result.parsed;
    return result;
  }

  private getDefaultConfig() {
    return {
      version: 1,
      agent_permissions: {
        orchestrator: 'enabled',
        research: 'enabled',
        email: 'enabled',
        file_code: 'enabled',
        chaos: 'enabled'
      },
      off_limits: { paths: ['/private', '/finance', '~/.ssh'] },
      rules: {
        confirm_before_send_email: true,
        max_file_size_mb: 50,
        chaos_mode: 'adventurous'
      }
    };
  }
}
