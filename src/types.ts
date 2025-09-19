export type FileStats = {
  size: number;
  mtime: Date;
  ctime: Date;
  birthtime: Date;
};

export type PdfMetadata = {
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
  producer?: string;
  pages?: number;
  [key: string]: unknown;
};

export type EpubMetadata = {
  title?: string;
  creator?: string;
  description?: string;
  language?: string;
  date?: string;
  [key: string]: unknown;
};

export type BookMetadata = {
  path: string;
  filename: string;
  type: 'pdf' | 'epub';
  metadata?: PdfMetadata | EpubMetadata;
  fileStats: FileStats;
  error?: string;
  imagePath?: string;
};

export type ProcessingSummary = {
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  pdfFiles: number;
  epubFiles: number;
  failedFiles: number;
  mode: 'full-scan' | 'update' | 'update-cover' | 'search' | 'update-both' | 'update-pdf' | 'update-epub';
};

export type Config = {
  folders: string[];
  excludes?: string[];
  output?: string;
  includes?: string[];
  backupDir?: string;
  duplicateDir?: string;
  outputDir?: string;
  dataFile?: string;
  timestampFormat?: string;
  tokenization?: {
    enabled?: boolean;
    minTokenLength?: number;
    maxTokenLength?: number;
    removeStopwords?: boolean;
    useStemming?: boolean;
    customStopwords?: string[];
    fieldsToTokenize?: string[];
  };
  index?: {
    compress?: boolean;
  };
};

export type OutputData = {
  summary: ProcessingSummary;
  books: BookMetadata[];
};
