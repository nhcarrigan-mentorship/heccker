import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

export class DocxGenerator {
  static async generate(content: string, title: string): Promise<Buffer> {
    const lines = content.split('\n');
    const children = [
      new Paragraph({
        text: title,
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 400 },
      }),
    ];

    lines.forEach(line => {
      if (line.trim()) {
        const isHeading = line.startsWith('# ') || line.startsWith('## ') || line.toUpperCase() === line;
        children.push(
          new Paragraph({
            children: [new TextRun(line.replace(/^#+\s/, ''))],
            heading: isHeading ? HeadingLevel.HEADING_2 : undefined,
            spacing: { before: isHeading ? 200 : 100, after: 100 },
          })
        );
      }
    });

    const doc = new Document({
      sections: [{ children }],
    });

    return await Packer.toBuffer(doc);
  }
}
