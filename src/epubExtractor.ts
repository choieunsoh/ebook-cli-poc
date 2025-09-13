import Epub from 'epub';
import { statSync } from 'fs';
import { basename } from 'path';
import { BookMetadata, EpubMetadata, FileStats } from './types';

export function extractEpubMetadata(filePath: string): Promise<BookMetadata> {
  return new Promise((resolve, reject) => {
    try {
      const epub = new Epub(filePath);

      epub.on('end', () => {
        const meta = epub.metadata as unknown as Record<string, unknown>;
        const metadata: EpubMetadata = {
          title: meta.title as string,
          creator: meta.creator as string,
          description: meta.description as string,
          language: meta.language as string,
          date: meta.date as string,
          ...meta,
        };

        const stats = statSync(filePath);
        const fileStats: FileStats = {
          size: stats.size,
          mtime: stats.mtime,
          ctime: stats.ctime,
          birthtime: stats.birthtime,
        };

        resolve({
          path: filePath,
          filename: basename(filePath),
          type: 'epub',
          metadata,
          fileStats,
        });
      });

      epub.on('error', (error: Error) => {
        reject(new Error(`Failed to extract EPUB metadata from ${filePath}: ${error.message}`));
      });

      epub.parse();
    } catch (error) {
      reject(new Error(`Failed to initialize EPUB parser for ${filePath}: ${(error as Error).message}`));
    }
  });
}
