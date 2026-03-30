import { Injectable, BadRequestException, OnModuleInit, Logger } from '@nestjs/common';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ConfigService implements OnModuleInit {
  private readonly logger = new Logger(ConfigService.name);
  private currentConfig: any = null;
  private currentRawYaml: string = '';

  onModuleInit() {
    this.loadConcaFromFile();
  }

  loadConcaFromFile() {
    try {
      // Config service runs inside services/config/, so the root is ../../
      const concaPath = path.join(process.cwd(), '../../.conca');
      if (fs.existsSync(concaPath)) {
        const fileContent = fs.readFileSync(concaPath, 'utf8');
        this.currentRawYaml = fileContent;
        this.saveConfig(fileContent);
        this.logger.log(`Successfully loaded master configuration from ${concaPath}`);
      } else {
        this.logger.warn(`No .conca file found at ${concaPath}. Falling back to hardcoded defaults.`);
      }
    } catch (e: any) {
      this.logger.error(`Failed to load physical .conca file: ${e.message}`);
    }
  }

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
      
      if (parsed.connectors) {
        if (!Array.isArray(parsed.connectors)) {
          errors.push("'connectors' must be an array");
        } else {
          parsed.connectors.forEach((conn: any, idx: number) => {
            if (!conn.name) errors.push(`Connector at index ${idx} is missing 'name'`);
            if (!conn.mcp) errors.push(`Connector '${conn.name || idx}' is missing 'mcp' URL`);
          });
        }
      }

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
    const data = this.currentConfig || this.getDefaultConfig();
    return { ...data, raw_yaml: this.currentRawYaml };
  }

  saveConfig(yamlString: string) {
    const result = this.validateConca(yamlString);
    if (!result.valid) {
      throw new BadRequestException({ message: "Invalid .conca file", errors: result.errors });
    }
    this.currentConfig = result.parsed;
    this.currentRawYaml = yamlString;

    try {
      const concaPath = path.join(process.cwd(), '../../.conca');
      fs.writeFileSync(concaPath, yamlString, 'utf8');
      this.logger.log(`Successfully saved .conca file to disk`);
    } catch(e: any) {
       this.logger.error(`Failed to physically write .conca file: ${e.message}`);
    }

    return result;
  }

  private getDefaultConfig() {
    return {
      version: 1,
      agent_permissions: {
        orchestrator: 'enabled',
        research: 'enabled',
        email: 'enabled',
        'file-code': 'enabled',
        chaos: 'enabled'
      },
      connectors: [],
      off_limits: { paths: ['/private', '/finance', '~/.ssh', 'C:\\Windows'] },
      rules: {
        confirm_before_send_email: true,
        max_file_size_mb: 50,
        chaos_mode: 'adventurous'
      }
    };
  }
}
