export interface FileStats {
  size: number;
  mtime: Date;
  ctime: Date;
  birthtime: Date;
}

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
  producer?: string;
  pages?: number;
  [key: string]: unknown;
}

export interface EpubMetadata {
  title?: string;
  creator?: string;
  description?: string;
  language?: string;
  date?: string;
  [key: string]: unknown;
}

export interface BookMetadata {
  path: string;
  filename: string;
  type: 'pdf' | 'epub';
  metadata: PdfMetadata | EpubMetadata;
  fileStats: FileStats;
}

export interface ProcessingSummary {
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  pdfFiles: number;
  epubFiles: number;
  failedFiles: number;
  mode: 'full-scan' | 'update';
}

export interface OutputData {
  summary: ProcessingSummary;
  books: BookMetadata[];
}
