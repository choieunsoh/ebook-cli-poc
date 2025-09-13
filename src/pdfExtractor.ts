import { readFileSync, statSync } from 'fs';
import { basename } from 'path';
import pdfParse from 'pdf-parse';
import { BookMetadata, FileStats, PdfMetadata } from './types';

export async function extractPdfMetadata(filePath: string): Promise<BookMetadata> {
  try {
    const buffer = readFileSync(filePath);
    const data = await pdfParse(buffer);

    const metadata: PdfMetadata = {
      title: data.info?.Title,
      author: data.info?.Author,
      subject: data.info?.Subject,
      creator: data.info?.Creator,
      producer: data.info?.Producer,
      pages: data.numpages,
      ...data.metadata,
    };

    const stats = statSync(filePath);
    const fileStats: FileStats = {
      size: stats.size,
      mtime: stats.mtime,
      ctime: stats.ctime,
      birthtime: stats.birthtime,
    };

    return {
      path: filePath,
      filename: basename(filePath),
      type: 'pdf',
      metadata,
      fileStats,
    };
  } catch (error) {
    throw new Error(`Failed to extract PDF metadata from ${filePath}: ${(error as Error).message}`);
  }
}
