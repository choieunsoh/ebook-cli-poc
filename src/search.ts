/**
 * Main search functionality for full-text search across ebooks.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ChangeDetector } from './changeDetector';
import { DataFileContent, DataFileReader } from './dataFileReader';
import { IndexMetadata, SearchDocument, SearchIndex, SearchResult } from './searchIndex';
import { extractTextFromFile, TextExtractionOptions } from './textExtractor';
import { tokenizeForIndexing, tokenizeQuery } from './tokenizer';

/**
 * Memory monitoring utilities
 */
function getMemoryUsage() {
  const memUsage = process.memoryUsage();
  return {
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
    external: Math.round(memUsage.external / 1024 / 1024),
    rss: Math.round(memUsage.rss / 1024 / 1024),
  };
}

function forceGarbageCollection() {
  if (global.gc) {
    global.gc();
  }
}

function isMemoryUsageHigh(maxMemoryUsageMB: number): boolean {
  const usage = getMemoryUsage();
  const totalUsed = usage.heapUsed + usage.external;
  return totalUsed > maxMemoryUsageMB * 0.8; // 80% threshold
}

export interface SearchOptions {
  indexFile?: string;
  limit?: number;
  fuzzy?: boolean;
  verbose?: boolean;
}

export interface SearchStats {
  totalDocuments: number;
  searchTime: number;
  resultsFound: number;
}

export interface IncrementalBuildOptions {
  dataFilePath?: string;
  verbose?: boolean;
  forceFullRebuild?: boolean;
  maxFileSizeMB?: number;
  maxMemoryUsageMB?: number;
  skipLargeFiles?: boolean;
  extractPartialContent?: boolean;
  maxPages?: number;
  // Batch processing options
  useBatchProcessing?: boolean;
  batchSize?: number;
  batchDir?: string;
  // File limit option
  maxFiles?: number;
}

export interface IncrementalBuildResult {
  added: number;
  modified: number;
  deleted: number;
  unchanged: number;
  totalProcessed: number;
  isFullRebuild: boolean;
  failed: number;
  failedFiles: Array<{ path: string; error: string }>;
  invertedIndexTermCount?: number;
  topFrequentTerms?: Array<{ term: string; frequency: number }>;
}

export class EbookSearch {
  private index: SearchIndex;
  private indexFilePath: string;
  private TOP_FREQUENT_TERMS = 10;

  constructor(indexFilePath: string = 'search-index.json') {
    this.indexFilePath = indexFilePath;
    this.index = new SearchIndex(this.getIndexCompressionSetting(), this.getTokenizationConfig());
  }

  /**
   * Generates an excerpt from full text content for indexing
   */
  private generateExcerpt(text: string, maxLength: number = 10000): string {
    if (text.length <= maxLength) {
      return text;
    }

    // For longer texts, take excerpts from beginning, middle, and end
    const excerptLength = Math.floor(maxLength / 3);
    const beginning = text.substring(0, excerptLength);
    const middleStart = Math.floor(text.length / 2) - Math.floor(excerptLength / 2);
    const middle = text.substring(Math.max(0, middleStart), middleStart + excerptLength);
    const endStart = text.length - excerptLength;
    const end = text.substring(Math.max(0, endStart));

    return `${beginning}\n\n[...middle section...]\n\n${middle}\n\n[...end section...]\n\n${end}`;
  }

  /**
   * Builds the search index from ebook files
   */
  async buildIndex(ebookFiles: string[], options: { verbose?: boolean; append?: boolean } = {}): Promise<void> {
    const { verbose = false, append = false } = options;

    if (verbose) {
      console.log(`${append ? 'Appending to' : 'Building'} search index from ${ebookFiles.length} files...`);
    }

    let successCount = 0;
    let failureCount = 0;

    for (const filePath of ebookFiles) {
      try {
        if (verbose) {
          console.log(`Processing: ${path.basename(filePath)}`);
        }

        // Extract text content
        const textResult = await extractTextFromFile(filePath);
        if (textResult.error && !textResult.success) {
          if (verbose) {
            console.warn(`Failed to extract text from ${filePath}: ${textResult.error}`);
          }
          failureCount++;
          continue;
        }

        // Count success
        successCount++;

        // Tokenize the extracted text
        const tokenizationConfig = this.getTokenizationConfig();
        const tokens = await tokenizeForIndexing(
          textResult.text,
          tokenizationConfig.mode === 'bert' && tokenizationConfig.enabled,
          tokenizationConfig.bertModel,
        );

        // Create search document
        const docId = this.generateDocumentId(filePath);
        const doc: SearchDocument = {
          id: docId,
          excerpt: this.generateExcerpt(textResult.text), // Store excerpt for display
          filePath,
          type: path.extname(filePath).toLowerCase() === '.pdf' ? 'pdf' : 'epub',
          // Note: In a full implementation, you'd extract title/author from metadata
          // For now, we'll use filename as title
          title: path.basename(filePath, path.extname(filePath)),
          wordCount: textResult.wordCount,
          tokenCount: tokens.length,
        };

        // Check if document already exists when appending
        if (append && this.index.hasDocument(docId)) {
          if (verbose) {
            console.log(`  Updating existing document: ${docId}`);
          }
          this.index.updateDocument(doc, textResult.text);
        } else {
          this.index.addDocument(doc, textResult.text); // Index full text but only store excerpt
        }

        if (verbose) {
          console.log(`  Indexed ${textResult.wordCount || 0} words, ${tokens.length} tokens`);
        }
      } catch (error) {
        if (verbose) {
          console.error(`Error processing ${filePath}:`, error);
        }
        failureCount++;
      }
    }

    if (verbose) {
      console.log(`Index ${append ? 'updated' : 'built'} with ${this.index.getDocumentCount()} documents`);
      console.log(`Extraction results: ${successCount} successful, ${failureCount} failed`);
    }
  }

  /**
   * Builds the search index incrementally from data.json with optional batch processing
   */
  async buildIndexIncremental(options: IncrementalBuildOptions = {}): Promise<IncrementalBuildResult> {
    const {
      dataFilePath,
      verbose = false,
      forceFullRebuild = false,
      maxFileSizeMB = 500, // Increased for academic documents
      maxMemoryUsageMB = 4096, // Increased to 4GB for full text indexing
      skipLargeFiles = false, // Don't skip large files for academic use
      extractPartialContent = false, // Extract full content for research
      maxPages = 0, // 0 = unlimited pages
      useBatchProcessing = true, // Enabled by default for both full and incremental updates
      batchSize = 5, // Smaller batches for memory management
      batchDir = './batch-indexes',
      maxFiles = 100, // Default limit for processing
    } = options;

    const extractionOptions: TextExtractionOptions = {
      maxFileSizeMB,
      maxMemoryUsageMB,
      skipLargeFiles,
      extractPartialContent,
      maxPages,
    };

    // Determine data file path from config or parameter
    let actualDataFilePath: string | undefined = dataFilePath;
    if (!actualDataFilePath) {
      actualDataFilePath = (await this.getDataFilePathFromConfig()) || undefined;
      if (!actualDataFilePath) {
        throw new Error('No data file path specified and could not find config.json');
      }
    }

    // Load data file
    const dataFileReader = new DataFileReader(actualDataFilePath);
    const dataFileContent = await dataFileReader.loadDataFile();

    if (!dataFileContent) {
      throw new Error(`Could not load data file: ${actualDataFilePath}`);
    }

    // Load existing index if it exists
    const indexExists = this.indexExists();
    if (indexExists && !forceFullRebuild) {
      await this.loadIndex();
    }

    const indexMetadata = this.index.getMetadata();
    const changeDetector = new ChangeDetector();

    // Check if we need a full rebuild
    // If we have an existing index with documents but no metadata, treat it as incremental with missing metadata
    const hasExistingDocuments = this.index.getDocumentCount() > 0;
    const dataFileChanged = changeDetector.hasDataFileChanged(dataFileContent, indexMetadata);
    const isFullRebuild = forceFullRebuild || !indexExists || (!hasExistingDocuments && dataFileChanged);

    if (isFullRebuild) {
      // Use batch processing if requested for full rebuilds
      if (useBatchProcessing) {
        if (verbose) {
          console.log('Performing full index rebuild with batch processing...');
        }
        return await this.performBatchRebuild(
          dataFileContent,
          dataFileReader,
          verbose,
          extractionOptions,
          batchSize,
          batchDir,
          maxFiles,
        );
      } else {
        if (verbose) {
          console.log('Performing full index rebuild...');
        }
        return await this.performFullRebuild(dataFileContent, dataFileReader, verbose, extractionOptions, maxFiles);
      }
    } else {
      // Use batch processing if requested for incremental updates
      if (useBatchProcessing) {
        if (verbose) {
          console.log('Performing incremental index update with batch processing...');
        }
        return await this.performBatchIncrementalUpdate(
          dataFileContent,
          indexMetadata,
          verbose,
          extractionOptions,
          batchSize,
          batchDir,
          maxFiles,
        );
      } else {
        if (verbose) {
          console.log('Performing incremental index update...');
        }
        return await this.performIncrementalUpdate(
          dataFileContent,
          indexMetadata,
          verbose,
          extractionOptions,
          maxFiles,
        );
      }
    }
  }

  /**
   * Performs a search query
   */
  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<{
    results: SearchResult[];
    stats: SearchStats;
  }> {
    const { limit = 20, fuzzy = false, verbose = false } = options;

    const startTime = Date.now();

    if (verbose) {
      console.log(`Searching for: "${query}"`);
    }

    // Load index if not already loaded
    if (this.index.getDocumentCount() === 0) {
      await this.loadIndex();
    }

    // Perform search
    let results = await this.index.search(query, limit);

    // Apply fuzzy matching if requested and no exact results
    if (fuzzy && results.length === 0) {
      // Simple fuzzy: try partial matches
      const fuzzyResults = await this.fuzzySearch(query, limit);
      results = fuzzyResults;
    }

    const searchTime = Date.now() - startTime;

    if (verbose) {
      console.log(`Found ${results.length} results in ${searchTime}ms`);
    }

    const stats: SearchStats = {
      totalDocuments: this.index.getDocumentCount(),
      searchTime,
      resultsFound: results.length,
    };

    return { results, stats };
  }

  /**
   * Performs fuzzy search for partial matches
   */
  private async fuzzySearch(query: string, limit: number): Promise<SearchResult[]> {
    const tokenizationConfig = this.getTokenizationConfig();
    const queryTokens = await tokenizeQuery(
      query,
      tokenizationConfig.mode === 'bert' && tokenizationConfig.enabled,
      tokenizationConfig.bertModel,
    );
    const allResults = new Map<string, SearchResult>();

    // Try each token individually
    for (const token of queryTokens) {
      const results = await this.index.search(token, limit * 2); // Get more results for fuzzy
      for (const result of results) {
        if (!allResults.has(result.id)) {
          // Reduce score for partial matches
          allResults.set(result.id, { ...result, score: result.score * 0.5 });
        }
      }
    }

    return Array.from(allResults.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Saves the search index to disk
   */
  async saveIndex(): Promise<void> {
    await this.index.exportToFile(this.indexFilePath);
  }

  /**
   * Loads the search index from disk
   */
  async loadIndex(): Promise<void> {
    // Always try to import - importFromFile handles both single file and split file detection
    if (this.indexExists()) {
      await this.index.importFromFile(this.indexFilePath);
    }
  }

  /**
   * Checks if index file exists (supports both single file and split file formats)
   */
  indexExists(): boolean {
    // Check for single file
    if (fs.existsSync(this.indexFilePath)) {
      return true;
    }

    // Check for split file format (manifest file) in search-indexes directory
    const basePath = this.indexFilePath.replace(/\.[^/.]+$/, '');
    const extension = this.indexFilePath.match(/\.[^/.]+$/)?.[0] || '.json';

    const baseFileName = basePath.split('/').pop() || basePath.split('\\').pop() || 'search-index';
    const indexDir = 'search-indexes';
    const manifestFile = `${indexDir}/${baseFileName}.manifest${extension}`;

    return fs.existsSync(manifestFile);
  }

  /**
   * Gets index statistics
   */
  getStats(): { documentCount: number; indexSize: number } {
    const documentCount = this.index.getDocumentCount();
    let indexSize = 0;

    // Check for split-file system first
    const basePath = this.indexFilePath.replace(/\.[^/.]+$/, '');
    const extension = this.indexFilePath.match(/\.[^/.]+$/)?.[0] || '.json';
    const baseFileName = basePath.split('/').pop() || basePath.split('\\').pop() || 'search-index';
    const indexDir = 'search-indexes';
    const manifestFile = `${indexDir}/${baseFileName}.manifest${extension}`;

    if (fs.existsSync(manifestFile)) {
      // Calculate total size of all split files
      try {
        const files = fs.readdirSync(indexDir);
        const indexFiles = files.filter((file) => file.startsWith(baseFileName) && file.endsWith(extension));

        for (const file of indexFiles) {
          try {
            const filePath = path.join(indexDir, file);
            const stats = fs.statSync(filePath);
            indexSize += stats.size;
          } catch {
            // Ignore individual file errors
          }
        }
      } catch {
        // Ignore directory read errors
      }
    } else if (fs.existsSync(this.indexFilePath)) {
      // Fallback to single file
      try {
        const stats = fs.statSync(this.indexFilePath);
        indexSize = stats.size;
      } catch {
        // Ignore errors
      }
    }

    return { documentCount, indexSize };
  }

  /**
   * Gets comprehensive index statistics including percentiles and term analysis
   */
  getIndexStatistics(topK: number = 10): {
    totalDocuments: number;
    totalTerms: number;
    totalTokens: number;
    averageDocumentSize: number;
    averageTermFrequency: number;
    averageTermFrequencyWithoutSingletons: number;
    singletonTermsCount: number;
    singletonTermsPercentage: number;
    termFrequencies: number[];
    percentiles: {
      p25: number;
      p50: number;
      p75: number;
    };
    percentilesWithoutSingletons: {
      p25: number;
      p50: number;
      p75: number;
    };
    topTermsWithPercentages: Array<{ term: string; frequency: number; percentage: number }>;
  } {
    return this.index.getIndexStatistics(topK);
  }

  /**
   * Clears the search index (supports both single file and split file formats)
   */
  clearIndex(): void {
    this.index.clear();

    // Remove single file if it exists
    if (fs.existsSync(this.indexFilePath)) {
      fs.unlinkSync(this.indexFilePath);
    }

    // Remove split files if they exist in search-indexes directory
    const basePath = this.indexFilePath.replace(/\.[^/.]+$/, '');
    const extension = this.indexFilePath.match(/\.[^/.]+$/)?.[0] || '.json';

    const baseFileName = basePath.split('/').pop() || basePath.split('\\').pop() || 'search-index';
    const indexDir = 'search-indexes';
    const indexBasePath = `${indexDir}/${baseFileName}`;
    const manifestFile = `${indexBasePath}.manifest${extension}`;

    if (fs.existsSync(manifestFile)) {
      try {
        // Read manifest to get list of files to delete
        const manifestData = fs.readFileSync(manifestFile, 'utf-8');
        const manifest = JSON.parse(manifestData);

        // Delete all split files with zero-padded names
        fs.unlinkSync(manifestFile);
        fs.unlinkSync(`${indexBasePath}.metadata${extension}`);

        for (let i = 0; i < manifest.documentChunks; i++) {
          const docFile = `${indexBasePath}.docs.${i.toString().padStart(5, '0')}${extension}`;
          if (fs.existsSync(docFile)) {
            fs.unlinkSync(docFile);
          }
        }

        for (let i = 0; i < manifest.indexChunks; i++) {
          const indexFile = `${indexBasePath}.index.${i.toString().padStart(5, '0')}${extension}`;
          if (fs.existsSync(indexFile)) {
            fs.unlinkSync(indexFile);
          }
        }

        // Try to remove the search-indexes directory if it's empty
        try {
          fs.rmdirSync(indexDir);
        } catch {
          // Directory not empty or other error, ignore
        }
      } catch (error) {
        console.warn('Warning: Could not clean up all split index files:', error);
      }
    }
  } /**
   * Generates a unique document ID from file path
   */
  private generateDocumentId(filePath: string): string {
    // Use a hash of the file path for uniqueness
    let hash = 0;
    for (let i = 0; i < filePath.length; i++) {
      const char = filePath.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Gets the data file path from config.json
   */
  private async getDataFilePathFromConfig(): Promise<string | null> {
    try {
      const configPath = path.join(process.cwd(), 'config.json');
      if (!fs.existsSync(configPath)) {
        return null;
      }

      const configData = await fs.promises.readFile(configPath, 'utf-8');
      const config = JSON.parse(configData);

      if (config.dataFile) {
        return path.join(process.cwd(), config.outputDir || 'output', config.dataFile);
      }
    } catch (error) {
      console.warn('Warning: Could not read config.json:', error);
    }

    return null;
  }

  /**
   * Gets the index compression setting from config.json
   */
  private getIndexCompressionSetting(): boolean {
    try {
      const configPath = path.join(process.cwd(), 'config.json');
      if (!fs.existsSync(configPath)) {
        return true; // Default to compression enabled
      }

      const configData = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configData);

      return config.index?.compress !== false; // Default to true if not specified
    } catch (error) {
      console.warn('Warning: Could not read config.json for compression setting:', error);
      return true; // Default to compression enabled
    }
  }

  /**
   * Gets the tokenization configuration from config.json
   */
  private getTokenizationConfig(): { mode: string; bertModel?: string; enabled: boolean } {
    try {
      const configPath = path.join(process.cwd(), 'config.json');
      if (!fs.existsSync(configPath)) {
        return { mode: 'basic', enabled: true }; // Default to basic tokenization
      }

      const configData = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configData);

      if (config.tokenization) {
        const tokenization = config.tokenization;
        return {
          mode: tokenization.mode || 'basic',
          bertModel: tokenization.bert?.model,
          enabled: tokenization.enabled !== false,
        };
      }
    } catch (error) {
      console.warn('Warning: Could not read tokenization config:', error);
    }

    return { mode: 'basic', enabled: true }; // Default fallback
  }

  /**
   * Performs a full rebuild of the index
   */
  private async performFullRebuild(
    dataFileContent: DataFileContent,
    dataFileReader: DataFileReader,
    verbose: boolean,
    extractionOptions: TextExtractionOptions,
    maxFiles: number,
  ): Promise<IncrementalBuildResult> {
    // Clear existing index
    this.index.clear();

    // Limit the number of entries to process
    const limitedEntries = dataFileContent.entries.slice(0, maxFiles);

    if (verbose) {
      console.log(`Processing ${limitedEntries.length} files (limited from ${dataFileContent.entries.length} total)`);
    }

    // Process all files from data.json
    const documents: SearchDocument[] = [];
    const fullTexts: string[] = [];
    let processedCount = 0;
    let failedCount = 0;
    const failedFiles: Array<{ path: string; error: string }> = [];

    for (const entry of limitedEntries) {
      try {
        if (verbose) {
          console.log(`Processing: ${path.basename(entry.fileMetadata.path)}`);
        }

        // Extract text content
        const textResult = await extractTextFromFile(entry.fileMetadata.path, extractionOptions);
        if (textResult.error && !textResult.success) {
          if (verbose) {
            console.warn(`Failed to extract text from ${entry.fileMetadata.path}: ${textResult.error}`);
          }
          failedCount++;
          failedFiles.push({ path: entry.fileMetadata.path, error: textResult.error });
          continue;
        }

        // Tokenize the extracted text
        const tokenizationConfig = this.getTokenizationConfig();
        const tokens = await tokenizeForIndexing(
          textResult.text,
          tokenizationConfig.mode === 'bert' && tokenizationConfig.enabled,
          tokenizationConfig.bertModel,
        );

        // Create search document
        const docId = this.generateDocumentId(entry.fileMetadata.path);
        const doc: SearchDocument = {
          id: docId,
          excerpt: this.generateExcerpt(textResult.text), // Store excerpt for display/index size
          filePath: entry.fileMetadata.path,
          type: entry.type === 'pdf' ? 'pdf' : 'epub',
          title: this.extractTitleFromEntry(entry),
          author: this.extractAuthorFromEntry(entry),
          wordCount: textResult.wordCount,
          tokenCount: tokens.length,
        };

        documents.push(doc);
        fullTexts.push(textResult.text); // Store full text for indexing
        processedCount++;

        if (verbose) {
          console.log(`  Indexed ${textResult.wordCount || 0} words, ${tokens.length} tokens`);
        }
      } catch (error) {
        if (verbose) {
          console.error(`Error processing ${entry.fileMetadata.path}:`, error);
        }
        failedCount++;
        failedFiles.push({ path: entry.fileMetadata.path, error: (error as Error).message });
      }
    }

    // Add all documents to index
    this.index.addDocumentsBatch(documents, fullTexts);

    // Update metadata
    this.index.updateMetadata(dataFileContent.hash);

    if (verbose) {
      console.log(`Full rebuild completed: ${processedCount} documents indexed`);
    }

    return {
      added: processedCount,
      modified: 0,
      deleted: 0,
      unchanged: 0,
      totalProcessed: processedCount,
      isFullRebuild: true,
      failed: failedCount,
      failedFiles,
      invertedIndexTermCount: this.index.getInvertedIndexTermCount(),
      topFrequentTerms: this.index.getTopFrequentTerms(this.TOP_FREQUENT_TERMS),
    };
  }

  /**
   * Performs an incremental update of the index
   */
  private async performIncrementalUpdate(
    dataFileContent: DataFileContent,
    indexMetadata: IndexMetadata | null,
    verbose: boolean,
    extractionOptions: TextExtractionOptions,
    maxFiles: number,
  ): Promise<IncrementalBuildResult> {
    const changeDetector = new ChangeDetector();

    // If metadata is missing, create a minimal metadata structure for change detection
    const workingMetadata = indexMetadata || {
      lastUpdated: new Date().toISOString(),
      totalFiles: 0,
      indexedFiles: {},
    };

    const changes = changeDetector.detectChanges(dataFileContent, workingMetadata);

    // Limit the total number of files to process
    const totalChanges = changes.added.length + changes.modified.length + changes.deleted.length;
    if (totalChanges > maxFiles) {
      if (verbose) {
        console.log(`Limiting processing to ${maxFiles} files out of ${totalChanges} total changes`);
      }
      // Prioritize added files, then modified, then deleted
      changes.added = changes.added.slice(0, maxFiles);
      const remaining = maxFiles - changes.added.length;
      if (remaining > 0) {
        changes.modified = changes.modified.slice(0, remaining);
        const stillRemaining = remaining - changes.modified.length;
        if (stillRemaining > 0) {
          changes.deleted = changes.deleted.slice(0, stillRemaining);
        } else {
          changes.deleted = [];
        }
      } else {
        changes.modified = [];
        changes.deleted = [];
      }
    }

    if (verbose) {
      console.log(
        `Changes detected: +${changes.added.length} added, ~${changes.modified.length} modified, -${changes.deleted.length} deleted, =${changes.unchanged} unchanged`,
      );
    }

    let addedCount = 0;
    let modifiedCount = 0;
    let failedCount = 0;
    const failedFiles: Array<{ path: string; error: string }> = [];

    // Process added files
    if (changes.added.length > 0) {
      const addedDocs: SearchDocument[] = [];
      const addedTexts: string[] = [];
      for (const entry of changes.added) {
        try {
          if (verbose) {
            console.log(`Adding: ${path.basename(entry.fileMetadata.path)}`);
          }

          const textResult = await extractTextFromFile(entry.fileMetadata.path, extractionOptions);
          if (textResult.error && !textResult.success) {
            if (verbose) {
              console.warn(`Failed to extract text from ${entry.fileMetadata.path}: ${textResult.error}`);
            }
            failedCount++;
            failedFiles.push({ path: entry.fileMetadata.path, error: textResult.error });
            continue;
          }

          // Tokenize the extracted text
          const tokenizationConfig = this.getTokenizationConfig();
          const tokens = await tokenizeForIndexing(
            textResult.text,
            tokenizationConfig.mode === 'bert' && tokenizationConfig.enabled,
            tokenizationConfig.bertModel,
          );

          const docId = this.generateDocumentId(entry.fileMetadata.path);
          const doc: SearchDocument = {
            id: docId,
            excerpt: this.generateExcerpt(textResult.text), // Store excerpt for display
            filePath: entry.fileMetadata.path,
            type: entry.type === 'pdf' ? 'pdf' : 'epub',
            title: this.extractTitleFromEntry(entry),
            author: this.extractAuthorFromEntry(entry),
            wordCount: textResult.wordCount,
            tokenCount: tokens.length,
          };

          addedDocs.push(doc);
          addedTexts.push(textResult.text);
          addedCount++;

          if (verbose) {
            console.log(`  Indexed ${textResult.wordCount || 0} words, ${tokens.length} tokens`);
          }
        } catch (error) {
          if (verbose) {
            console.error(`Error adding ${entry.fileMetadata.path}:`, error);
          }
          failedCount++;
          failedFiles.push({ path: entry.fileMetadata.path, error: (error as Error).message });
        }
      }
      this.index.addDocumentsBatch(addedDocs, addedTexts);
    } // Process modified files
    if (changes.modified.length > 0) {
      const modifiedDocs: SearchDocument[] = [];
      const modifiedTexts: string[] = [];
      for (const entry of changes.modified) {
        try {
          if (verbose) {
            console.log(`Updating: ${path.basename(entry.fileMetadata.path)}`);
          }

          const textResult = await extractTextFromFile(entry.fileMetadata.path, extractionOptions);
          if (textResult.error) {
            if (verbose) {
              console.warn(`Failed to extract text from ${entry.fileMetadata.path}: ${textResult.error}`);
            }
            failedCount++;
            failedFiles.push({ path: entry.fileMetadata.path, error: textResult.error });
            continue;
          }

          // Tokenize the extracted text
          const tokenizationConfig = this.getTokenizationConfig();
          const tokens = await tokenizeForIndexing(
            textResult.text,
            tokenizationConfig.mode === 'bert' && tokenizationConfig.enabled,
            tokenizationConfig.bertModel,
          );

          const docId = this.generateDocumentId(entry.fileMetadata.path);
          const doc: SearchDocument = {
            id: docId,
            excerpt: this.generateExcerpt(textResult.text), // Store excerpt for display
            filePath: entry.fileMetadata.path,
            type: entry.type === 'pdf' ? 'pdf' : 'epub',
            title: this.extractTitleFromEntry(entry),
            author: this.extractAuthorFromEntry(entry),
            wordCount: textResult.wordCount,
            tokenCount: tokens.length,
          };

          modifiedDocs.push(doc);
          modifiedTexts.push(textResult.text);
          modifiedCount++;

          if (verbose) {
            console.log(`  Indexed ${textResult.wordCount || 0} words, ${tokens.length} tokens`);
          }
        } catch (error) {
          if (verbose) {
            console.error(`Error updating ${entry.fileMetadata.path}:`, error);
          }
          failedCount++;
          failedFiles.push({ path: entry.fileMetadata.path, error: (error as Error).message });
        }
      }
      this.index.updateDocumentsBatch(
        modifiedDocs.map((doc, i) => ({ id: doc.id, doc, fullTextForIndexing: modifiedTexts[i] })),
      );
    }

    // Process deleted files
    if (changes.deleted.length > 0) {
      const deletedIds = changes.deleted.map((filePath) => this.generateDocumentId(filePath));
      this.index.removeDocumentsBatch(deletedIds);

      if (verbose) {
        console.log(`Removed ${changes.deleted.length} deleted files from index`);
      }
    }

    // Update metadata
    this.index.updateMetadata(dataFileContent.hash);

    const totalProcessed = addedCount + modifiedCount + changes.deleted.length;

    if (verbose) {
      console.log(`Incremental update completed: ${totalProcessed} files processed`);
    }

    return {
      added: addedCount,
      modified: modifiedCount,
      deleted: changes.deleted.length,
      unchanged: changes.unchanged,
      totalProcessed,
      isFullRebuild: false,
      failed: failedCount,
      failedFiles,
      invertedIndexTermCount: this.index.getInvertedIndexTermCount(),
      topFrequentTerms: this.index.getTopFrequentTerms(this.TOP_FREQUENT_TERMS),
    };
  }

  /**
   * Performs a batch incremental update of the index
   */
  private async performBatchIncrementalUpdate(
    dataFileContent: DataFileContent,
    indexMetadata: IndexMetadata | null,
    verbose: boolean,
    extractionOptions: TextExtractionOptions,
    batchSize: number,
    batchDir: string,
    maxFiles: number,
  ): Promise<IncrementalBuildResult> {
    const changeDetector = new ChangeDetector();

    // If metadata is missing, create a minimal metadata structure for change detection
    const workingMetadata = indexMetadata || {
      lastUpdated: new Date().toISOString(),
      totalFiles: 0,
      indexedFiles: {},
    };

    const changes = changeDetector.detectChanges(dataFileContent, workingMetadata);

    // Limit the total number of files to process
    const totalChanges = changes.added.length + changes.modified.length + changes.deleted.length;
    if (totalChanges > maxFiles) {
      if (verbose) {
        console.log(`Limiting processing to ${maxFiles} files out of ${totalChanges} total changes`);
      }
      // Prioritize added files, then modified, then deleted
      changes.added = changes.added.slice(0, maxFiles);
      const remaining = maxFiles - changes.added.length;
      if (remaining > 0) {
        changes.modified = changes.modified.slice(0, remaining);
        const stillRemaining = remaining - changes.modified.length;
        if (stillRemaining > 0) {
          changes.deleted = changes.deleted.slice(0, stillRemaining);
        } else {
          changes.deleted = [];
        }
      } else {
        changes.modified = [];
        changes.deleted = [];
      }
    }

    if (verbose) {
      console.log(
        `Changes detected: +${changes.added.length} added, ~${changes.modified.length} modified, -${changes.deleted.length} deleted, =${changes.unchanged} unchanged`,
      );
    }

    // Create batch directory if it doesn't exist
    if (!fs.existsSync(batchDir)) {
      fs.mkdirSync(batchDir, { recursive: true });
    }

    // Clear any existing batch files
    this.clearBatchFiles(batchDir);

    // Combine all changed entries for batch processing
    const changedEntries = [...changes.added, ...changes.modified];
    const batchGenerator = this.createBatchGenerator(changedEntries, batchSize);
    let totalProcessed = 0;
    let totalFailed = 0;
    const allFailedFiles: Array<{ path: string; error: string }> = [];
    let batchIndex = 0;
    const totalFiles = Math.min(changedEntries.length, maxFiles);

    for (const batch of batchGenerator) {
      batchIndex++;

      // Check memory usage before processing batch
      if (isMemoryUsageHigh(extractionOptions.maxMemoryUsageMB || 4096)) {
        console.warn(`Warning: Memory usage is high before batch ${batchIndex}. Forcing garbage collection...`);
        forceGarbageCollection();
      }

      if (verbose) {
        console.log(`Processing batch ${batchIndex} (${batch.length} files)`);
        const memUsage = getMemoryUsage();
        console.log(`  Pre-batch memory: ${memUsage.heapUsed}MB heap, ${memUsage.external}MB external`);
      }

      // Create a temporary index for this batch
      const batchIndexInstance = new SearchIndex(this.getIndexCompressionSetting(), this.getTokenizationConfig());
      const batchDocuments: SearchDocument[] = [];
      const batchFullTexts: string[] = [];

      for (const entry of batch) {
        try {
          if (verbose) {
            console.log(`Processing (${totalProcessed + 1}/${totalFiles}): ${path.basename(entry.fileMetadata.path)}`);
          }

          const textResult = await extractTextFromFile(entry.fileMetadata.path, extractionOptions);
          if (textResult.error && !textResult.success) {
            if (verbose) {
              console.warn(`  Failed to extract text from ${entry.fileMetadata.path}: ${textResult.error}`);
            }
            totalFailed++;
            allFailedFiles.push({ path: entry.fileMetadata.path, error: textResult.error });
            continue;
          }

          // Tokenize the extracted text
          const tokenizationConfig = this.getTokenizationConfig();
          const tokens = await tokenizeForIndexing(
            textResult.text,
            tokenizationConfig.mode === 'bert' && tokenizationConfig.enabled,
            tokenizationConfig.bertModel,
          );

          const docId = this.generateDocumentId(entry.fileMetadata.path);
          const doc: SearchDocument = {
            id: docId,
            excerpt: this.generateExcerpt(textResult.text), // Store excerpt for display
            filePath: entry.fileMetadata.path,
            type: entry.type === 'pdf' ? 'pdf' : 'epub',
            title: this.extractTitleFromEntry(entry),
            author: this.extractAuthorFromEntry(entry),
            wordCount: textResult.wordCount,
            tokenCount: tokens.length,
          };

          batchDocuments.push(doc);
          batchFullTexts.push(textResult.text); // Store full text for indexing
          totalProcessed++;

          if (verbose) {
            console.log(`    Indexed ${textResult.wordCount || 0} words, ${tokens.length} tokens`);
          }
        } catch (error) {
          if (verbose) {
            console.error(`  Error processing ${entry.fileMetadata.path}:`, error);
          }
          totalFailed++;
          allFailedFiles.push({ path: entry.fileMetadata.path, error: (error as Error).message });
        }
      }

      // Add documents to batch index
      await batchIndexInstance.addDocumentsBatch(batchDocuments, batchFullTexts);

      if (verbose) {
        console.log(`  Batch ${batchIndex} completed: ${batchDocuments.length} documents`);
      }

      // Merge this batch immediately to avoid memory accumulation
      const docCount = batchIndexInstance.getDocumentCount();
      this.index.mergeIndex(batchIndexInstance);

      if (verbose) {
        console.log(`  Merged batch ${batchIndex} into main index (${docCount} documents)`);
      }

      // Clear the batch index from memory immediately
      batchIndexInstance.clear();

      // Force multiple garbage collection cycles for large batches
      if (docCount > 100) {
        forceGarbageCollection();
        // Give the GC some time to work
        await new Promise((resolve) => setTimeout(resolve, 100));
        forceGarbageCollection();
      } else {
        forceGarbageCollection();
      }

      if (verbose) {
        const memUsage = getMemoryUsage();
        console.log(
          `  Memory usage: ${memUsage.heapUsed}MB heap, ${memUsage.external}MB external, ${memUsage.rss}MB RSS`,
        );
      }
    }

    // Process deleted files
    if (changes.deleted.length > 0) {
      const deletedIds = changes.deleted.map((filePath) => this.generateDocumentId(filePath));
      this.index.removeDocumentsBatch(deletedIds);

      if (verbose) {
        console.log(`Removed ${changes.deleted.length} deleted files from index`);
      }
    }

    // Update metadata
    this.index.updateMetadata(dataFileContent.hash);

    // Clean up batch files
    this.clearBatchFiles(batchDir);

    const totalProcessedIncludingDeletes = totalProcessed + changes.deleted.length;

    if (verbose) {
      console.log(`Batch incremental update completed: ${totalProcessedIncludingDeletes} files processed`);
    }

    return {
      added: totalProcessed,
      modified: 0, // In batch mode, we don't distinguish between added and modified
      deleted: changes.deleted.length,
      unchanged: changes.unchanged,
      totalProcessed: totalProcessedIncludingDeletes,
      isFullRebuild: false,
      failed: totalFailed,
      failedFiles: allFailedFiles,
      invertedIndexTermCount: this.index.getInvertedIndexTermCount(),
      topFrequentTerms: this.index.getTopFrequentTerms(this.TOP_FREQUENT_TERMS),
    };
  }
  private async performBatchRebuild(
    dataFileContent: DataFileContent,
    dataFileReader: DataFileReader,
    verbose: boolean,
    extractionOptions: TextExtractionOptions,
    batchSize: number,
    batchDir: string,
    maxFiles: number,
  ): Promise<IncrementalBuildResult> {
    // Create batch directory if it doesn't exist
    if (!fs.existsSync(batchDir)) {
      fs.mkdirSync(batchDir, { recursive: true });
    }

    // Clear any existing batch files
    this.clearBatchFiles(batchDir);

    // Limit the number of entries to process
    const limitedEntries = dataFileContent.entries.slice(0, maxFiles);

    if (verbose) {
      console.log(
        `Processing ${limitedEntries.length} files in batches of ${batchSize} (limited from ${dataFileContent.entries.length} total)`,
      );
    }

    const batchGenerator = this.createBatchGenerator(limitedEntries, batchSize);
    let totalProcessed = 0;
    let totalFailed = 0;
    const allFailedFiles: Array<{ path: string; error: string }> = [];
    let batchIndex = 0;
    const totalFiles = limitedEntries.length;

    for (const batch of batchGenerator) {
      batchIndex++;

      // Check memory usage before processing batch
      if (isMemoryUsageHigh(extractionOptions.maxMemoryUsageMB || 4096)) {
        console.warn(`Warning: Memory usage is high before batch ${batchIndex}. Forcing garbage collection...`);
        forceGarbageCollection();
      }

      if (verbose) {
        console.log(`Processing batch ${batchIndex} (${batch.length} files)`);
        const memUsage = getMemoryUsage();
        console.log(`  Pre-batch memory: ${memUsage.heapUsed}MB heap, ${memUsage.external}MB external`);
      }

      // Create a temporary index for this batch
      const batchIndexInstance = new SearchIndex(this.getIndexCompressionSetting(), this.getTokenizationConfig());
      const batchDocuments: SearchDocument[] = [];
      const batchFullTexts: string[] = [];

      for (const entry of batch) {
        try {
          if (verbose) {
            console.log(`Processing (${totalProcessed + 1}/${totalFiles}): ${path.basename(entry.fileMetadata.path)}`);
          }

          const textResult = await extractTextFromFile(entry.fileMetadata.path, extractionOptions);
          if (textResult.error && !textResult.success) {
            if (verbose) {
              console.warn(`  Failed to extract text from ${entry.fileMetadata.path}: ${textResult.error}`);
            }
            totalFailed++;
            allFailedFiles.push({ path: entry.fileMetadata.path, error: textResult.error });
            continue;
          }

          // Tokenize the extracted text
          const tokenizationConfig = this.getTokenizationConfig();
          const tokens = await tokenizeForIndexing(
            textResult.text,
            tokenizationConfig.mode === 'bert' && tokenizationConfig.enabled,
            tokenizationConfig.bertModel,
          );

          const docId = this.generateDocumentId(entry.fileMetadata.path);
          const doc: SearchDocument = {
            id: docId,
            excerpt: this.generateExcerpt(textResult.text), // Store excerpt for display
            filePath: entry.fileMetadata.path,
            type: entry.type === 'pdf' ? 'pdf' : 'epub',
            title: this.extractTitleFromEntry(entry),
            author: this.extractAuthorFromEntry(entry),
            wordCount: textResult.wordCount,
            tokenCount: tokens.length,
          };

          batchDocuments.push(doc);
          batchFullTexts.push(textResult.text); // Store full text for indexing
          totalProcessed++;

          if (verbose) {
            console.log(`    Indexed ${textResult.wordCount || 0} words, ${tokens.length} tokens`);
          }
        } catch (error) {
          if (verbose) {
            console.error(`  Error processing ${entry.fileMetadata.path}:`, error);
          }
          totalFailed++;
          allFailedFiles.push({ path: entry.fileMetadata.path, error: (error as Error).message });
        }
      }

      // Add documents to batch index
      await batchIndexInstance.addDocumentsBatch(batchDocuments, batchFullTexts);

      if (verbose) {
        console.log(`  Batch ${batchIndex} completed: ${batchDocuments.length} documents`);
      }

      // Merge this batch immediately to avoid memory accumulation
      if (batchIndex === 1) {
        // First batch - initialize the main index
        this.index.clear();
        this.index.mergeIndex(batchIndexInstance);
        if (verbose) {
          console.log(`  Initialized index with first batch (${batchDocuments.length} documents)`);
        }
      } else {
        // Subsequent batches - merge into main index
        this.index.mergeIndex(batchIndexInstance);
        if (verbose) {
          console.log(`  Merged batch ${batchIndex} into main index (${batchDocuments.length} documents)`);
        }
      }

      // Clear the batch index from memory immediately
      batchIndexInstance.clear();

      // Force multiple garbage collection cycles for large batches
      if (batchDocuments.length > 100) {
        forceGarbageCollection();
        // Give the GC some time to work
        await new Promise((resolve) => setTimeout(resolve, 100));
        forceGarbageCollection();
      } else {
        forceGarbageCollection();
      }

      if (verbose) {
        const memUsage = getMemoryUsage();
        console.log(
          `  Memory usage: ${memUsage.heapUsed}MB heap, ${memUsage.external}MB external, ${memUsage.rss}MB RSS`,
        );
      }
    }

    // Update metadata
    this.index.updateMetadata(dataFileContent.hash);

    // Clean up batch files
    this.clearBatchFiles(batchDir);

    if (verbose) {
      console.log(`Batch rebuild completed: ${totalProcessed} documents indexed`);
    }

    return {
      added: totalProcessed,
      modified: 0,
      deleted: 0,
      unchanged: 0,
      totalProcessed,
      isFullRebuild: true,
      failed: totalFailed,
      failedFiles: allFailedFiles,
      invertedIndexTermCount: this.index.getInvertedIndexTermCount(),
      topFrequentTerms: this.index.getTopFrequentTerms(this.TOP_FREQUENT_TERMS),
    };
  }

  /**
   * Creates a generator that yields batches of entries
   */
  private *createBatchGenerator<T>(entries: T[], batchSize: number): Generator<T[]> {
    for (let i = 0; i < entries.length; i += batchSize) {
      yield entries.slice(i, i + batchSize);
    }
  }

  /**
   * Merges multiple batch index files into the main index
   */
  private async mergeBatchIndexes(batchFiles: string[], verbose: boolean): Promise<void> {
    // Clear the main index
    this.index.clear();

    for (const batchFile of batchFiles) {
      if (verbose) {
        console.log(`Merging batch: ${path.basename(batchFile)}`);
      }

      try {
        // Create a temporary index instance to load the compressed batch file
        const tempIndex = new SearchIndex(this.getIndexCompressionSetting(), this.getTokenizationConfig());
        await tempIndex.importFromFile(batchFile);

        const docCount = tempIndex.getDocumentCount();
        if (verbose) {
          console.log(`  Loaded ${docCount} documents from ${path.basename(batchFile)}`);
          console.log(`  Inverted index has ${tempIndex['invertedIndex'].size} terms`);
        }

        // Merge the complete index (documents + inverted index) into the main index
        this.index.mergeIndex(tempIndex);

        if (verbose) {
          console.log(`  Merged ${docCount} documents`);
        }
      } catch (error) {
        console.error(`Failed to merge batch ${batchFile}:`, error);
      }
    }
  }

  /**
   * Clears all batch files from the batch directory
   */
  private clearBatchFiles(batchDir: string): void {
    try {
      if (fs.existsSync(batchDir)) {
        const files = fs.readdirSync(batchDir);
        for (const file of files) {
          if (file.startsWith('batch-') && file.endsWith('.json')) {
            fs.unlinkSync(path.join(batchDir, file));
          }
        }
      }
    } catch (error) {
      console.warn('Warning: Could not clear batch files:', error);
    }
  }

  /**
   * Extracts title from data file entry
   */
  private extractTitleFromEntry(entry: {
    metadata: Record<string, unknown> | null;
    fileMetadata: { path: string };
  }): string {
    if (entry.metadata && typeof entry.metadata === 'object' && 'title' in entry.metadata) {
      const title = entry.metadata.title;
      if (typeof title === 'string') {
        return title;
      }
    }
    return path.basename(entry.fileMetadata.path, path.extname(entry.fileMetadata.path));
  }

  /**
   * Extracts author from data file entry
   */
  private extractAuthorFromEntry(entry: { metadata: Record<string, unknown> | null }): string | undefined {
    if (entry.metadata && typeof entry.metadata === 'object' && 'author' in entry.metadata) {
      const author = entry.metadata.author;
      if (typeof author === 'string') {
        return author;
      }
    }
    return undefined;
  }
}
