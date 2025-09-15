import Epub from 'epub';
import { mkdirSync, statSync } from 'fs';
import { basename, join } from 'path';
import sharp from 'sharp';
import { BookMetadata, EpubMetadata, FileStats } from './types';

export function extractEpubMetadata(
  filePath: string,
  extractImage: boolean = false,
  extractMetadata: boolean = true,
): Promise<BookMetadata> {
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

      epub.on('end', async () => {
        let metadata: EpubMetadata | undefined;
        if (extractMetadata) {
          const meta = epub.metadata as unknown as Record<string, unknown>;
          metadata = {
            title: meta.title as string,
            creator: meta.creator as string,
            description: meta.description as string,
            language: meta.language as string,
            date: meta.date as string,
            ...meta,
          };
        }

        const result: BookMetadata = {
          path: filePath,
          filename: basename(filePath),
          type: 'epub',
          metadata,
          fileStats,
        };

        // Extract cover image
        if (extractImage) {
          const metadataObj = epub.metadata as Record<string, unknown>;
          if (metadataObj.cover) {
            try {
              const imgBuffer = await new Promise<Buffer>((resolveImg, rejectImg) => {
                epub.getImage(metadataObj.cover as string, (error, img) => {
                  if (error) rejectImg(error);
                  else resolveImg(img);
                });
              });
              mkdirSync('images', { recursive: true });
              const imagePath = join('images', basename(filePath, '.epub') + '.webp');
              await sharp(imgBuffer).webp().toFile(imagePath);
              result.imagePath = imagePath;
            } catch (imgError) {
              console.warn(`Warning: Failed to extract cover from ${filePath}: ${(imgError as Error).message}`);
            }
          }
        }

        resolve(result);
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
