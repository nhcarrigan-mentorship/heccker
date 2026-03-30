import { Controller, All, Req, Res, Next } from '@nestjs/common';
import type { Request, Response } from 'express';

@Controller()
export class ProxyController {
  @All('*')
  async proxy(@Req() req: Request, @Res() res: Response) {
    let targetPort = 3001; // Default to Orchestrator
    
    if (req.originalUrl.startsWith('/agents/email') || req.originalUrl.startsWith('/agents/google-workspace')) {
      targetPort = 3003;
    } else if (req.originalUrl.startsWith('/agents/history') || req.originalUrl.startsWith('/agents/orchestrate')) {
      targetPort = 3001;
    }
    
    const targetUrl = `http://127.0.0.1:${targetPort}${req.originalUrl}`;
    
    // Handle CORS preflight separately
    if (req.method === 'OPTIONS') {
      return res.status(204).send();
    }

    console.log(`[Gateway] Proxying ${req.method} ${req.originalUrl} to ${targetUrl}`);
    
    try {
      const fetchBody = ['POST', 'PUT', 'PATCH'].includes(req.method) 
          ? JSON.stringify(req.body) 
          : undefined;
      
      if (fetchBody) console.log(`[Gateway] Body: ${fetchBody}`);

      const response = await fetch(targetUrl, {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: fetchBody,
      });

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        return res.status(response.status).json(data);
      } else {
        const text = await response.text();
        console.warn(`[Gateway] Non-JSON response from ${targetUrl}: ${text.substring(0, 100)}`);
        return res.status(response.status).send(text);
      }
    } catch (error) {
      console.error(`[Gateway] Proxy error to ${targetUrl}:`, error.message);
      return res.status(502).json({
        success: false,
        message: 'Gateway Proxy Error',
        error: error.message,
      });
    }
  }
}
