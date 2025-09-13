import { readFileSync, statSync } from 'fs';
import { basename, dirname } from 'path';
import pdfParse from 'pdf-parse';
import { convertPdfCover } from './pdfCoverExtractor';
import { BookMetadata, FileStats, PdfMetadata } from './types';

export async function extractPdfMetadata(
  filePath: string,
  extractImage: boolean = false,
  extractMetadata: boolean = true,
): Promise<BookMetadata> {
  const stats = statSync(filePath);
  const fileStats: FileStats = {
    size: stats.size,
    mtime: stats.mtime,
    ctime: stats.ctime,
    birthtime: stats.birthtime,
  };

  try {
    const buffer = readFileSync(filePath);
    const data = await pdfParse(buffer);

    let metadata: PdfMetadata | undefined;
    if (extractMetadata) {
      metadata = {
        title: data.info?.Title,
        author: data.info?.Author,
        subject: data.info?.Subject,
        creator: data.info?.Creator,
        producer: data.info?.Producer,
        pages: data.numpages,
        ...data.metadata,
      };
    }

    const result: BookMetadata = {
      path: filePath,
      filename: basename(filePath),
      type: 'pdf',
      metadata,
      fileStats,
    };

    // Extract first page as image
    if (extractImage) {
      try {
        const inputFolder = dirname(filePath);
        const outputFolder = './images';
        const pdfFileName = basename(filePath);
        const density = 150;

        const imagePath = await convertPdfCover(inputFolder, outputFolder, pdfFileName, density);
        result.imagePath = imagePath;
      } catch (imgError) {
        console.warn(`Warning: Failed to extract image from ${filePath}: ${(imgError as Error).message}`);
      }
    }

    return result;
  } catch (error) {
    return {
      path: filePath,
      filename: basename(filePath),
      type: 'pdf',
      metadata: undefined,
      fileStats,
      error: `Failed to extract PDF metadata: ${(error as Error).message}`,
    };
  }
}
