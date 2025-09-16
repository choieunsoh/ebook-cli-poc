/**
 * Change detection logic for incremental indexing
 */

import * as path from 'path';
import { DataFileContent, DataFileEntry } from './dataFileReader';
import { IndexMetadata } from './searchIndex';

export interface ChangeDetectionResult {
  added: DataFileEntry[];
  modified: DataFileEntry[];
  deleted: string[]; // file paths
  unchanged: number;
}

export class ChangeDetector {
  /**
   * Detects changes between data file and existing index
   */
  detectChanges(dataFileContent: DataFileContent, indexMetadata: IndexMetadata | null): ChangeDetectionResult {
    const result: ChangeDetectionResult = {
      added: [],
      modified: [],
      deleted: [],
      unchanged: 0,
    };

    const dataFileMap = this.createDataFileMap(dataFileContent.entries);
    const indexedFiles = indexMetadata?.indexedFiles || {};

    // Check for added and modified files
    for (const entry of dataFileContent.entries) {
      const filePath = path.resolve(entry.fileMetadata.path);
      const indexedModified = indexedFiles[filePath];

      if (!indexedModified) {
        // File not in index - it's new
        result.added.push(entry);
      } else {
        // File exists in index - check if modified
        const dataModified = new Date(entry.fileMetadata.modified);
        const indexModified = new Date(indexedModified);

        if (dataModified > indexModified) {
          // File has been modified since last indexing
          result.modified.push(entry);
        } else {
          // File unchanged
          result.unchanged++;
        }
      }
    }

    // Check for deleted files (in index but not in data file)
    for (const indexedPath of Object.keys(indexedFiles)) {
      const resolvedPath = path.resolve(indexedPath);
      if (!dataFileMap.has(resolvedPath)) {
        result.deleted.push(indexedPath);
      }
    }

    return result;
  }

  /**
   * Creates a map of file paths to data entries for quick lookup
   */
  private createDataFileMap(entries: DataFileEntry[]): Map<string, DataFileEntry> {
    const fileMap = new Map<string, DataFileEntry>();

    for (const entry of entries) {
      const fullPath = path.resolve(entry.fileMetadata.path);
      fileMap.set(fullPath, entry);
    }

    return fileMap;
  }

  /**
   * Checks if data file has changed since last index update
   */
  hasDataFileChanged(dataFileContent: DataFileContent, indexMetadata: IndexMetadata | null): boolean {
    if (!indexMetadata?.dataFileHash) {
      return true; // No previous hash means it's changed
    }

    return dataFileContent.hash !== indexMetadata.dataFileHash;
  }
}
