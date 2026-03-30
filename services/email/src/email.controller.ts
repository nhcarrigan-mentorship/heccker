import { Controller, Get, Post, Body, Query, Res, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import type { Response } from 'express';

@Controller('agents/email')
export class EmailController {
  private readonly logger = new Logger(EmailController.name);

  @Get('auth')
  async auth(@Res() res: Response) {
    try {
      this.logger.log('Initiating OAuth flow...');
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      const scopes = [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/documents'
      ];

      const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent'
      });

      this.logger.log(`Redirecting to: ${url}`);
      return res.redirect(url);
    } catch (error: any) {
      this.logger.error(`Auth initiation failed: ${error.message}`);
      return res.status(500).send(`Auth initialization failed: ${error.message}`);
    }
  }

  @Get('callback')
  async callback(@Query('code') code: string, @Query('error') error: string) {
    if (error) {
      this.logger.error(`Google returned an error: ${error}`);
      return `<h2>OAuth Error from Google</h2><p>${error}</p>`;
    }

    if (!code) {
      this.logger.error('No code provided in callback');
      return `<h2>Error</h2><p>No authorization code received from Google.</p>`;
    }

    try {
      this.logger.log(`Exchanging code for tokens...`);
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      const { tokens } = await oauth2Client.getToken(code);
      this.logger.log('Tokens received successfully.');
      
      if (tokens.refresh_token) {
        this.logger.log(`Refresh Token: ${tokens.refresh_token.substring(0, 10)}...`);
        return `
          <div style="font-family: sans-serif; padding: 40px; background: #0f0f0f; color: white; border-radius: 12px; border: 1px solid #333;">
            <h2 style="color: #6366f1;">OAuth Success!</h2>
            <p>Copy this <b>GOOGLE_REFRESH_TOKEN</b> into your <code>.env</code> file:</p>
            <pre style="background: #1e1e2e; padding: 15px; border-radius: 8px; color: #f8f8f2; border: 1px solid #444;">GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}</pre>
          </div>
        `;
      } else {
        this.logger.warn('No refresh token returned.');
        return `
          <div style="font-family: sans-serif; padding: 40px; background: #0f0f0f; color: white;">
            <h2>Authorization Complete (No Refresh Token)</h2>
            <p>Google didn't send a refresh token. This usually happens if you've already authorized the app once.</p>
            <p>Go to <a href="https://myaccount.google.com/permissions" style="color: #6366f1;">Google Permissions</a> and remove the app before trying again.</p>
          </div>
        `;
      }
    } catch (err: any) {
      this.logger.error(`Token exchange failed: ${err.message}`);
      return `<h2>Token Exchange Failed</h2><p>${err.message}</p>`;
    }
  }

  @Post('send')
  async sendEmail(@Body() body: { recipient: string; subject: string; body: string }) {
    const { recipient, subject, body: content } = body;
    this.logger.log(`Direct send request to ${recipient}`);

    if (!process.env.GOOGLE_REFRESH_TOKEN) {
      return { success: false, message: "GOOGLE_REFRESH_TOKEN is missing. Please authenticate first." };
    }

    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );
      oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      
      // Create base64 encoded raw email
      const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
      const message = [
        `To: ${recipient}`,
        `Subject: ${utf8Subject}`,
        'Content-Type: text/plain; charset=utf-8',
        'MIME-Version: 1.0',
        '',
        content,
      ].join('\r\n');
      
      const raw = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      });

      return { success: true, message: "Email dispatched successfully" };
    } catch (error: any) {
      this.logger.error(`Gmail API send failed: ${error.message}`);
      return { 
        success: false, 
        message: `Gmail Send Failed: ${error.message}`,
        details: error.response?.data || error.errors 
      };
    }
  }
}
