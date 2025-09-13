import { readdirSync, statSync } from 'fs';
import { extname, join } from 'path';

export function listEbookFiles(folders: string[]): string[] {
  const ebookFiles: string[] = [];

  function scanDirectory(dirPath: string): void {
    try {
      const items = readdirSync(dirPath);
      for (const item of items) {
        const fullPath = join(dirPath, item);
        const stats = statSync(fullPath);

        if (stats.isDirectory()) {
          scanDirectory(fullPath);
        } else if (stats.isFile()) {
          const ext = extname(fullPath).toLowerCase();
          if (ext === '.pdf' || ext === '.epub') {
            ebookFiles.push(fullPath);
          }
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not access directory ${dirPath}: ${(error as Error).message}`);
    }
  }

  for (const folder of folders) {
    scanDirectory(folder);
  }

  return ebookFiles;
}
