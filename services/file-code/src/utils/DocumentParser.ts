import * as fs from 'fs/promises';
import * as path from 'path';
import * as mammoth from 'mammoth';
import * as pdf from 'pdf-parse';
import { parse as csvParse } from 'csv-parse/sync';

export class DocumentParser {
  static async parse(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();
    
    try {
      const buffer = await fs.readFile(filePath);
      
      switch (ext) {
        case '.docx':
          return await this.parseDocx(buffer);
        case '.pdf':
          return await this.parsePdf(buffer);
        case '.csv':
          return await this.parseCsv(buffer);
        case '.json':
          return this.parseJson(buffer);
        default:
          return buffer.toString('utf-8');
      }
    } catch (error: any) {
      throw new Error(`Failed to parse ${ext} document: ${error.message}`);
    }
  }

  private static async parseDocx(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  private static async parsePdf(buffer: Buffer): Promise<string> {
    // Use require for pdf-parse to avoid TS namespace import issues
    const pdfReader = require('pdf-parse');
    const data = await pdfReader(buffer);
    return data.text;
  }

  private static async parseCsv(buffer: Buffer): Promise<string> {
    const records = csvParse(buffer, {
      columns: true,
      skip_empty_lines: true
    });
    return JSON.stringify(records, null, 2);
  }

  private static parseJson(buffer: Buffer): string {
    const data = JSON.parse(buffer.toString('utf-8'));
    return JSON.stringify(data, null, 2);
  }
}
