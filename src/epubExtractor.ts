import Epub from 'epub';
import { statSync } from 'fs';
import { basename } from 'path';
import { BookMetadata, EpubMetadata, FileStats } from './types';

export function extractEpubMetadata(filePath: string): Promise<BookMetadata> {
  return new Promise((resolve) => {
    const stats = statSync(filePath);
    const fileStats: FileStats = {
      size: stats.size,
      mtime: stats.mtime,
      ctime: stats.ctime,
      birthtime: stats.birthtime,
    };

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

        resolve({
          path: filePath,
          filename: basename(filePath),
          type: 'epub',
          metadata,
          fileStats,
        });
      });

      epub.on('error', (error: Error) => {
        resolve({
          path: filePath,
          filename: basename(filePath),
          type: 'epub',
          metadata: undefined,
          fileStats,
          error: `Failed to extract EPUB metadata: ${error.message}`,
        });
      });

      epub.parse();
    } catch (error) {
      resolve({
        path: filePath,
        filename: basename(filePath),
        type: 'epub',
        metadata: undefined,
        fileStats,
        error: `Failed to initialize EPUB parser: ${(error as Error).message}`,
      });
    }
  });
}
