/**
 * Main search functionality for full-text search across ebooks.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ChangeDetector } from './changeDetector';
import { DataFileContent, DataFileReader } from './dataFileReader';
import { IndexMetadata, SearchDocument, SearchIndex, SearchResult } from './searchIndex';
import { extractTextFromFile, TextExtractionOptions } from './textExtractor';
import { tokenizeQuery } from './tokenizer';

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
}

export class EbookSearch {
  private index: SearchIndex;
  private indexFilePath: string;

  constructor(indexFilePath: string = 'search-index.json') {
    this.index = new SearchIndex();
    this.indexFilePath = indexFilePath;
  }

  /**
   * Builds the search index from ebook files
   */
  async buildIndex(ebookFiles: string[], options: { verbose?: boolean } = {}): Promise<void> {
    const { verbose = false } = options;

    if (verbose) {
      console.log(`Building search index from ${ebookFiles.length} files...`);
    }

    for (const filePath of ebookFiles) {
      try {
        if (verbose) {
          console.log(`Processing: ${path.basename(filePath)}`);
        }

        // Extract text content
        const textResult = await extractTextFromFile(filePath);
        if (textResult.error) {
          if (verbose) {
            console.warn(`Failed to extract text from ${filePath}: ${textResult.error}`);
          }
          continue;
        }

        // Create search document
        const docId = this.generateDocumentId(filePath);
        const doc: SearchDocument = {
          id: docId,
          content: textResult.text,
          filePath,
          type: path.extname(filePath).toLowerCase() === '.pdf' ? 'pdf' : 'epub',
          // Note: In a full implementation, you'd extract title/author from metadata
          // For now, we'll use filename as title
          title: path.basename(filePath, path.extname(filePath)),
        };

        this.index.addDocument(doc);

        if (verbose) {
          console.log(`  Indexed ${textResult.wordCount || 0} words`);
        }
      } catch (error) {
        if (verbose) {
          console.error(`Error processing ${filePath}:`, error);
        }
      }
    }

    if (verbose) {
      console.log(`Index built with ${this.index.getDocumentCount()} documents`);
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
      maxFileSizeMB = 100, // Increased default to be more permissive
      maxMemoryUsageMB = 2048, // Increased to 2GB for better performance
      skipLargeFiles = true,
      extractPartialContent = true,
      maxPages = 0, // 0 = unlimited pages
      useBatchProcessing = true, // Enabled by default for both full and incremental updates
      batchSize = 10,
      batchDir = './batch-indexes',
      maxFiles = 100, // Default limit of 100 files
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
    const isFullRebuild =
      forceFullRebuild || !indexExists || changeDetector.hasDataFileChanged(dataFileContent, indexMetadata);

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
          indexMetadata!,
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
          indexMetadata!,
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
    let results = this.index.search(query, limit);

    // Apply fuzzy matching if requested and no exact results
    if (fuzzy && results.length === 0) {
      // Simple fuzzy: try partial matches
      const fuzzyResults = this.fuzzySearch(query, limit);
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
  private fuzzySearch(query: string, limit: number): SearchResult[] {
    const queryTokens = tokenizeQuery(query);
    const allResults = new Map<string, SearchResult>();

    // Try each token individually
    for (const token of queryTokens) {
      const results = this.index.search(token, limit * 2); // Get more results for fuzzy
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
    if (fs.existsSync(this.indexFilePath)) {
      await this.index.importFromFile(this.indexFilePath);
    }
  }

  /**
   * Checks if index file exists
   */
  indexExists(): boolean {
    return fs.existsSync(this.indexFilePath);
  }

  /**
   * Gets index statistics
   */
  getStats(): { documentCount: number; indexSize: number } {
    const documentCount = this.index.getDocumentCount();
    let indexSize = 0;

    if (fs.existsSync(this.indexFilePath)) {
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
   * Clears the search index
   */
  clearIndex(): void {
    this.index.clear();
    if (fs.existsSync(this.indexFilePath)) {
      fs.unlinkSync(this.indexFilePath);
    }
  }

  /**
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
    let processedCount = 0;

    for (const entry of limitedEntries) {
      try {
        if (verbose) {
          console.log(`Processing: ${path.basename(entry.fileMetadata.path)}`);
        }

        // Extract text content
        const textResult = await extractTextFromFile(entry.fileMetadata.path, extractionOptions);
        if (textResult.error) {
          if (verbose) {
            console.warn(`Failed to extract text from ${entry.fileMetadata.path}: ${textResult.error}`);
          }
          continue;
        }

        // Create search document
        const docId = this.generateDocumentId(entry.fileMetadata.path);
        const doc: SearchDocument = {
          id: docId,
          content: textResult.text,
          filePath: entry.fileMetadata.path,
          type: entry.type === 'pdf' ? 'pdf' : 'epub',
          title: this.extractTitleFromEntry(entry),
          author: this.extractAuthorFromEntry(entry),
        };

        documents.push(doc);
        processedCount++;

        if (verbose) {
          console.log(`  Indexed ${textResult.wordCount || 0} words`);
        }
      } catch (error) {
        if (verbose) {
          console.error(`Error processing ${entry.fileMetadata.path}:`, error);
        }
      }
    }

    // Add all documents to index
    this.index.addDocumentsBatch(documents);

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
    };
  }

  /**
   * Performs an incremental update of the index
   */
  private async performIncrementalUpdate(
    dataFileContent: DataFileContent,
    indexMetadata: IndexMetadata,
    verbose: boolean,
    extractionOptions: TextExtractionOptions,
    maxFiles: number,
  ): Promise<IncrementalBuildResult> {
    const changeDetector = new ChangeDetector();
    const changes = changeDetector.detectChanges(dataFileContent, indexMetadata);

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

    // Process added files
    if (changes.added.length > 0) {
      const addedDocs: SearchDocument[] = [];
      for (const entry of changes.added) {
        try {
          if (verbose) {
            console.log(`Adding: ${path.basename(entry.fileMetadata.path)}`);
          }

          const textResult = await extractTextFromFile(entry.fileMetadata.path, extractionOptions);
          if (textResult.error) {
            if (verbose) {
              console.warn(`Failed to extract text from ${entry.fileMetadata.path}: ${textResult.error}`);
            }
            continue;
          }

          const docId = this.generateDocumentId(entry.fileMetadata.path);
          const doc: SearchDocument = {
            id: docId,
            content: textResult.text,
            filePath: entry.fileMetadata.path,
            type: entry.type === 'pdf' ? 'pdf' : 'epub',
            title: this.extractTitleFromEntry(entry),
            author: this.extractAuthorFromEntry(entry),
          };

          addedDocs.push(doc);
          addedCount++;
        } catch (error) {
          if (verbose) {
            console.error(`Error adding ${entry.fileMetadata.path}:`, error);
          }
        }
      }
      this.index.addDocumentsBatch(addedDocs);
    }

    // Process modified files
    if (changes.modified.length > 0) {
      const modifiedDocs: SearchDocument[] = [];
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
            continue;
          }

          const docId = this.generateDocumentId(entry.fileMetadata.path);
          const doc: SearchDocument = {
            id: docId,
            content: textResult.text,
            filePath: entry.fileMetadata.path,
            type: entry.type === 'pdf' ? 'pdf' : 'epub',
            title: this.extractTitleFromEntry(entry),
            author: this.extractAuthorFromEntry(entry),
          };

          modifiedDocs.push(doc);
          modifiedCount++;
        } catch (error) {
          if (verbose) {
            console.error(`Error updating ${entry.fileMetadata.path}:`, error);
          }
        }
      }
      this.index.updateDocumentsBatch(modifiedDocs.map((doc) => ({ id: doc.id, doc })));
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
    };
  }

  /**
   * Performs a batch incremental update of the index
   */
  private async performBatchIncrementalUpdate(
    dataFileContent: DataFileContent,
    indexMetadata: IndexMetadata,
    verbose: boolean,
    extractionOptions: TextExtractionOptions,
    batchSize: number,
    batchDir: string,
    maxFiles: number,
  ): Promise<IncrementalBuildResult> {
    const changeDetector = new ChangeDetector();
    const changes = changeDetector.detectChanges(dataFileContent, indexMetadata);

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
    const batchFiles: string[] = [];
    let totalProcessed = 0;
    let batchIndex = 0;

    for (const batch of batchGenerator) {
      batchIndex++;
      const batchFileName = `batch-${batchIndex.toString().padStart(3, '0')}.json`;
      const batchFilePath = path.join(batchDir, batchFileName);

      if (verbose) {
        console.log(`Processing batch ${batchIndex} (${batch.length} files) -> ${batchFileName}`);
      }

      // Create a temporary index for this batch
      const batchIndexInstance = new SearchIndex();
      const batchDocuments: SearchDocument[] = [];

      for (const entry of batch) {
        try {
          if (verbose) {
            console.log(`  Processing: ${path.basename(entry.fileMetadata.path)}`);
          }

          const textResult = await extractTextFromFile(entry.fileMetadata.path, extractionOptions);
          if (textResult.error) {
            if (verbose) {
              console.warn(`  Failed to extract text from ${entry.fileMetadata.path}: ${textResult.error}`);
            }
            continue;
          }

          const docId = this.generateDocumentId(entry.fileMetadata.path);
          const doc: SearchDocument = {
            id: docId,
            content: textResult.text,
            filePath: entry.fileMetadata.path,
            type: entry.type === 'pdf' ? 'pdf' : 'epub',
            title: this.extractTitleFromEntry(entry),
            author: this.extractAuthorFromEntry(entry),
          };

          batchDocuments.push(doc);
          totalProcessed++;

          if (verbose) {
            console.log(`    Indexed ${textResult.wordCount || 0} words`);
          }
        } catch (error) {
          if (verbose) {
            console.error(`  Error processing ${entry.fileMetadata.path}:`, error);
          }
        }
      }

      // Add documents to batch index and save
      batchIndexInstance.addDocumentsBatch(batchDocuments);
      await batchIndexInstance.exportToFile(batchFilePath);
      batchFiles.push(batchFilePath);

      if (verbose) {
        console.log(`  Batch ${batchIndex} saved: ${batchDocuments.length} documents`);
      }
    }

    // Merge all batch indexes into the main index
    if (verbose) {
      console.log(`Merging ${batchFiles.length} batch indexes...`);
    }

    for (const batchFile of batchFiles) {
      if (verbose) {
        console.log(`Merging batch: ${path.basename(batchFile)}`);
      }

      try {
        // Read batch file directly as JSON
        const batchData = JSON.parse(await fs.promises.readFile(batchFile, 'utf-8'));
        this.index.addDocumentsBatch(batchData.documents);
      } catch (error) {
        console.error(`Failed to merge batch ${batchFile}:`, error);
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
    const batchFiles: string[] = [];
    let totalProcessed = 0;
    let batchIndex = 0;

    for (const batch of batchGenerator) {
      batchIndex++;
      const batchFileName = `batch-${batchIndex.toString().padStart(3, '0')}.json`;
      const batchFilePath = path.join(batchDir, batchFileName);

      if (verbose) {
        console.log(`Processing batch ${batchIndex} (${batch.length} files) -> ${batchFileName}`);
      }

      // Create a temporary index for this batch
      const batchIndexInstance = new SearchIndex();
      const batchDocuments: SearchDocument[] = [];

      for (const entry of batch) {
        try {
          if (verbose) {
            console.log(`  Processing: ${path.basename(entry.fileMetadata.path)}`);
          }

          const textResult = await extractTextFromFile(entry.fileMetadata.path, extractionOptions);
          if (textResult.error) {
            if (verbose) {
              console.warn(`  Failed to extract text from ${entry.fileMetadata.path}: ${textResult.error}`);
            }
            continue;
          }

          const docId = this.generateDocumentId(entry.fileMetadata.path);
          const doc: SearchDocument = {
            id: docId,
            content: textResult.text,
            filePath: entry.fileMetadata.path,
            type: entry.type === 'pdf' ? 'pdf' : 'epub',
            title: this.extractTitleFromEntry(entry),
            author: this.extractAuthorFromEntry(entry),
          };

          batchDocuments.push(doc);
          totalProcessed++;

          if (verbose) {
            console.log(`    Indexed ${textResult.wordCount || 0} words`);
          }
        } catch (error) {
          if (verbose) {
            console.error(`  Error processing ${entry.fileMetadata.path}:`, error);
          }
        }
      }

      // Add documents to batch index and save
      batchIndexInstance.addDocumentsBatch(batchDocuments);
      await batchIndexInstance.exportToFile(batchFilePath);
      batchFiles.push(batchFilePath);

      if (verbose) {
        console.log(`  Batch ${batchIndex} saved: ${batchDocuments.length} documents`);
      }
    }

    // Merge all batch indexes
    if (verbose) {
      console.log(`Merging ${batchFiles.length} batch indexes...`);
    }

    await this.mergeBatchIndexes(batchFiles, verbose);

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
        // Read batch file directly as JSON
        const batchData = JSON.parse(await fs.promises.readFile(batchFile, 'utf-8'));
        this.index.addDocumentsBatch(batchData.documents);
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
