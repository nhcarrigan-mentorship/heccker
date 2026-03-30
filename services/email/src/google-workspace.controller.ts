import { Controller, Post, Body, Logger } from '@nestjs/common';
import { google } from 'googleapis';

@Controller('agents/google-workspace')
export class GoogleWorkspaceController {
  private readonly logger = new Logger(GoogleWorkspaceController.name);

  private getOAuthClient() {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    return oauth2Client;
  }

  @Post('create-doc')
  async createDoc(@Body() body: { title: string; content: string }) {
    const { title, content } = body;
    this.logger.log(`Creating Google Doc: ${title}`);

    try {
      const auth = this.getOAuthClient();
      const docs = google.docs({ version: 'v1', auth });
      const drive = google.drive({ version: 'v3', auth });

      // 1. Create a blank document
      const doc = await docs.documents.create({
        requestBody: { title },
      });

      const documentId = doc.data.documentId;

      // 2. Insert content
      if (documentId) {
        await docs.documents.batchUpdate({
          documentId,
          requestBody: {
            requests: [
              {
                insertText: {
                  location: { index: 1 },
                  text: content,
                },
              },
            ],
          },
        });
      }

      return { success: true, documentId, url: `https://docs.google.com/document/d/${documentId}/edit` };
    } catch (error: any) {
      this.logger.error(`Docs creation failed: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  @Post('search-drive')
  async searchDrive(@Body() body: { query: string }) {
    const { query } = body;
    this.logger.log(`Searching Google Drive: ${query}`);

    try {
      const auth = this.getOAuthClient();
      const drive = google.drive({ version: 'v3', auth });

      const response = await drive.files.list({
        q: `name contains '${query}'`,
        fields: 'files(id, name, webViewLink, mimeType)',
      });

      return { success: true, files: response.data.files };
    } catch (error: any) {
      this.logger.error(`Drive search failed: ${error.message}`);
      return { success: false, message: error.message };
    }
  }
}
