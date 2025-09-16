/**
 * Data file reader for incremental indexing from data.json
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface DataFileEntry {
  file: string;
  type: string;
  fileMetadata: {
    path: string;
    size: number;
    created: string;
    modified: string;
    accessed: string;
  };
  metadata: Record<string, unknown> | null;
  tokens?: string[];
}

export interface DataFileContent {
  entries: DataFileEntry[];
  hash: string;
  lastModified: string;
}

export class DataFileReader {
  private dataFilePath: string;

  constructor(dataFilePath: string) {
    this.dataFilePath = dataFilePath;
  }

  /**
   * Loads and parses the data.json file
   */
  async loadDataFile(): Promise<DataFileContent | null> {
    try {
      if (!fs.existsSync(this.dataFilePath)) {
        return null;
      }

      const content = await fs.promises.readFile(this.dataFilePath, 'utf-8');
      const data = JSON.parse(content);

      // Handle both array format and object format
      const entries = Array.isArray(data) ? data : data.entries || [];

      // Calculate hash for change detection
      const hash = crypto.createHash('md5').update(content).digest('hex');

      // Get file modification time
      const stats = await fs.promises.stat(this.dataFilePath);
      const lastModified = stats.mtime.toISOString();

      return {
        entries,
        hash,
        lastModified,
      };
    } catch (error) {
      console.warn(`Warning: Failed to load data file ${this.dataFilePath}:`, error);
      return null;
    }
  }

  /**
   * Creates a map of file paths to their metadata for quick lookup
   */
  createFileMap(entries: DataFileEntry[]): Map<string, DataFileEntry> {
    const fileMap = new Map<string, DataFileEntry>();

    for (const entry of entries) {
      const fullPath = path.resolve(entry.fileMetadata.path);
      fileMap.set(fullPath, entry);
    }

    return fileMap;
  }

  /**
   * Gets all file paths from the data file
   */
  getAllFilePaths(entries: DataFileEntry[]): string[] {
    return entries.map((entry) => path.resolve(entry.fileMetadata.path));
  }
}
