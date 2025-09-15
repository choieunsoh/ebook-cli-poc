/**
 * Type definitions for the ebook metadata extraction CLI.
 */

/**
 * Represents the complete set of user choices for the metadata extraction process.
 */
export type UserChoices = {
  /** Type of update: 'diff' for incremental updates, 'full' for complete scan, 'append' for appending batch results, 'summarize' for summarizing data, 'search' for searching by title */
  updateType: 'diff' | 'full' | 'append' | 'summarize' | 'search';
  /** File types to process: 'both' for PDF+EPUB, or specific type */
  fileType: 'both' | 'pdf' | 'epub';
  /** Metadata extraction scope: 'file-metadata', 'metadata' only, or 'metadata+cover' for images too */
  metadataType: 'file-metadata' | 'metadata' | 'metadata+cover';
  /** Number of files to process in each batch */
  batchSize: number;
  /** Batches directory for append operation */
  batchDir?: string;
  /** Whether to display list of files without metadata for summarize */
  displayWithoutMetadata?: boolean;
  /** Search term for search operation */
  searchTerm?: string;
};

/**
 * Represents the extracted PDF metadata.
 */
export type PDFMetadata = {
  title?: string;
  author?: string;
  creator?: string;
  producer?: string;
  subject?: string;
  creationDate?: string;
  modDate?: string;
  pages?: number;
  keywords?: string;
  // Additional fields from pdf2json
  formatVersion?: string;
  isAcroFormPresent?: boolean;
  isXFAPresent?: boolean;
};

/**
 * Represents the extracted EPUB metadata.
 */
export type EPUBMetadata = {
  title?: string;
  creator?: string;
  description?: string;
  language?: string;
  date?: string;
  [key: string]: unknown;
};

/**
 * Unified metadata type for both PDF and EPUB files.
 */
export type BookMetadata = PDFMetadata | EPUBMetadata;

/**
 * Represents basic file metadata.
 */
export type FileMetadata = {
  size: number;
  created: Date;
  modified: Date;
  accessed: Date;
  path: string;
};

/**
 * Configuration loaded from config.json
 */
export type Config = {
  includes: string[];
  outputDir: string;
  output: string;
  excludes: string[];
  timestampFormat: string;
  dataFile?: string;
};

/**
 * Represents a file entry with its name and containing directory.
 */
export type FileEntry = {
  file: string;
  dir: string;
};

/**
 * Represents the result of processing a file.
 */
export type ProcessingResult = {
  file: string;
  type: string;
  fileMetadata: FileMetadata;
  metadata: BookMetadata | null;
};

/**
 * Summary statistics for file processing results.
 */
export type ProcessingSummary = {
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  successfulExtractions: number;
  failedExtractions: number;
  pdfFiles: number;
  epubFiles: number;
  totalSize: number;
  averageFileSize: number;
  processingTime: number;
  filesPerSecond: number;
  averageTimePerFile: number;
  totalDataProcessed: number;
  dataThroughput: number;
};
