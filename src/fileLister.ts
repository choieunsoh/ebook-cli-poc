import { readdirSync, statSync } from 'fs';
import { extname, join, sep } from 'path';

export function listEbookFiles(folders: string[], excludes: string[] = []): string[] {
  const ebookFiles: string[] = [];
  const excludeSet = new Set(excludes.map((ex) => ex.replace(/[/\\]$/, ''))); // normalize, remove trailing sep

  function scanDirectory(dirPath: string): void {
    if (excludeSet.has(dirPath) || excludes.some((ex) => dirPath.startsWith(ex + sep))) {
      return;
    }
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
