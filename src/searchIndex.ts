/**
 * Search indexing utilities using a simple inverted index for full-text search.
 */

import * as fs from 'fs';
import * as zlib from 'zlib';
import { tokenizeForIndexing, tokenizeMetadataForIndexing } from './tokenizer';

/**
 * Utility function to create and display a progress bar in terminal
 */
function createProgressBar(current: number, total: number, label: string, barWidth: number = 40): string {
  const percentage = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * barWidth);
  const empty = barWidth - filled;

  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const progress = `${current.toLocaleString()}/${total.toLocaleString()}`;

  return `${label}: [${bar}] ${percentage}% (${progress})`;
}

/**
 * Progress tracking state to avoid console output collision
 */
let lastProgressOutput = '';

/**
 * Utility function to update progress in place (overwrite current line)
 */
function updateProgress(current: number, total: number, label: string): void {
  const progressBar = createProgressBar(current, total, label);

  // Only update if progress has changed significantly to avoid flickering
  if (progressBar !== lastProgressOutput) {
    // Clear the current line and write the progress bar
    process.stdout.write(`\r\x1b[K${progressBar}`); // \x1b[K clears from cursor to end of line
    lastProgressOutput = progressBar;
  }

  // Add newline when complete and reset state
  if (current >= total) {
    process.stdout.write('\n');
    lastProgressOutput = '';
  }
}

export interface SearchDocument {
  id: string;
  title?: string;
  author?: string;
  excerpt?: string; // Text for display and search result excerpts (truncated)
  filePath: string;
  type: 'pdf' | 'epub';
  wordCount?: number; // Number of words extracted from the document
  tokenCount?: number; // Number of tokens after tokenization
}

export interface SearchResult {
  id: string;
  title?: string;
  author?: string;
  filePath: string;
  type: 'pdf' | 'epub';
  score: number;
  excerpt?: string;
  wordCount?: number; // Number of words extracted from the document
  tokenCount?: number; // Number of tokens after tokenization
}

export interface IndexMetadata {
  lastUpdated: string;
  totalFiles: number;
  dataFileHash?: string;
  indexedFiles: Record<string, string>; // filePath -> lastModified
}

export interface IndexData {
  metadata?: IndexMetadata;
  documents: SearchDocument[];
  invertedIndex: [string, string[]][];
}

export class SearchIndex {
  private documents: Map<string, SearchDocument> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map(); // term -> document IDs
  private metadata: IndexMetadata | null = null;
  private compress: boolean = true;
  private tokenizationConfig: { mode: string; bertModel?: string; enabled: boolean };

  constructor(
    compress: boolean = true,
    tokenizationConfig: { mode: string; bertModel?: string; enabled: boolean } = { mode: 'basic', enabled: true },
  ) {
    this.compress = compress;
    this.tokenizationConfig = tokenizationConfig;
  }

  /**
   * Adds multiple documents to the search index in batch
   */
  async addDocumentsBatch(docs: SearchDocument[], fullTextsForIndexing?: string[]): Promise<void> {
    for (let i = 0; i < docs.length; i++) {
      const fullText = fullTextsForIndexing ? fullTextsForIndexing[i] : undefined;
      await this.addDocument(docs[i], fullText);
    }
  }

  /**
   * Updates multiple documents in the index
   */
  async updateDocumentsBatch(
    updates: { id: string; doc: SearchDocument; fullTextForIndexing?: string }[],
  ): Promise<void> {
    for (const update of updates) {
      await this.updateDocument(update.doc, update.fullTextForIndexing);
    }
  }

  /**
   * Removes multiple documents from the index
   */
  removeDocumentsBatch(ids: string[]): void {
    for (const id of ids) {
      this.removeDocument(id);
    }
  }

  /**
   * Adds a document to the search index
   */
  async addDocument(doc: SearchDocument, fullTextForIndexing?: string): Promise<void> {
    this.documents.set(doc.id, doc);

    // Tokenize and index the provided full text, or fallback to excerpt
    const textToIndex = fullTextForIndexing || doc.excerpt || '';
    const tokens = await tokenizeForIndexing(
      textToIndex,
      this.tokenizationConfig.mode === 'bert' && this.tokenizationConfig.enabled,
      this.tokenizationConfig.bertModel,
    );
    const uniqueTokens = new Set(tokens);

    for (const token of uniqueTokens) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token)!.add(doc.id);
    }

    // Also index title and author if present
    if (doc.title) {
      const titleTokens = await tokenizeMetadataForIndexing(
        doc.title,
        this.tokenizationConfig.mode === 'bert' && this.tokenizationConfig.enabled,
        this.tokenizationConfig.bertModel,
      );
      for (const token of titleTokens) {
        if (!this.invertedIndex.has(token)) {
          this.invertedIndex.set(token, new Set());
        }
        this.invertedIndex.get(token)!.add(doc.id);
      }
    }

    if (doc.author) {
      const authorTokens = await tokenizeMetadataForIndexing(
        doc.author,
        this.tokenizationConfig.mode === 'bert' && this.tokenizationConfig.enabled,
        this.tokenizationConfig.bertModel,
      );
      for (const token of authorTokens) {
        if (!this.invertedIndex.has(token)) {
          this.invertedIndex.set(token, new Set());
        }
        this.invertedIndex.get(token)!.add(doc.id);
      }
    }
  }

  /**
   * Updates an existing document in the index
   */
  async updateDocument(doc: SearchDocument, fullTextForIndexing?: string): Promise<void> {
    this.removeDocument(doc.id);
    await this.addDocument(doc, fullTextForIndexing);
  }

  /**
   * Removes a document from the index
   */
  removeDocument(id: string): void {
    const doc = this.documents.get(id);
    if (!doc) return;

    this.documents.delete(id);

    // Remove from inverted index
    for (const [term, docIds] of this.invertedIndex) {
      docIds.delete(id);
      if (docIds.size === 0) {
        this.invertedIndex.delete(term);
      }
    }
  }

  /**
   * Searches the index for matching documents
   */
  async search(query: string, limit: number = 20): Promise<SearchResult[]> {
    const queryTokens = await tokenizeForIndexing(
      query,
      this.tokenizationConfig.mode === 'bert' && this.tokenizationConfig.enabled,
      this.tokenizationConfig.bertModel,
    );
    if (queryTokens.length === 0) return [];

    // Find documents that contain all query terms (AND search)
    const docScores = new Map<string, number>();

    for (const token of queryTokens) {
      const docIds = this.invertedIndex.get(token);
      if (docIds) {
        for (const docId of docIds) {
          docScores.set(docId, (docScores.get(docId) || 0) + 1);
        }
      }
    }

    // Convert to results with scoring
    const results: SearchResult[] = [];
    for (const [docId, score] of docScores) {
      const doc = this.documents.get(docId);
      if (!doc) continue;

      // Create excerpt from stored excerpt around the first match
      const textForExcerpt = doc.excerpt || '';
      const excerpt = this.createExcerpt(textForExcerpt, query);

      results.push({
        id: doc.id,
        title: doc.title,
        author: doc.author,
        filePath: doc.filePath,
        type: doc.type,
        score,
        excerpt,
        wordCount: doc.wordCount,
        tokenCount: doc.tokenCount,
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  /**
   * Creates a text excerpt around the search query from stored excerpt
   */
  private createExcerpt(excerpt: string, query: string, contextLength: number = 100): string {
    const lowerExcerpt = excerpt.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const queryIndex = lowerExcerpt.indexOf(lowerQuery);

    if (queryIndex === -1) {
      // If query not found in excerpt, return beginning of excerpt
      return excerpt.length > contextLength * 2 ? excerpt.substring(0, contextLength * 2) + '...' : excerpt;
    }

    const start = Math.max(0, queryIndex - contextLength);
    const end = Math.min(excerpt.length, queryIndex + query.length + contextLength);

    let excerptSnippet = excerpt.substring(start, end);
    if (start > 0) excerptSnippet = '...' + excerptSnippet;
    if (end < excerpt.length) excerptSnippet = excerptSnippet + '...';

    return excerptSnippet;
  }

  /**
   * Checks if a document exists in the index
   */
  hasDocument(id: string): boolean {
    return this.documents.has(id);
  }

  /**
   * Gets the total number of documents in the index
   */
  getDocumentCount(): number {
    return this.documents.size;
  }

  /**
   * Gets all document IDs
   */
  getAllDocumentIds(): string[] {
    return Array.from(this.documents.keys());
  }

  /**
   * Gets all documents
   */
  getAllDocuments(): SearchDocument[] {
    return Array.from(this.documents.values());
  }

  /**
   * Exports the index to a file (optionally compressed)
   * Falls back to split-file approach for very large indexes
   */
  async exportToFile(filePath: string): Promise<void> {
    try {
      // Try standard single-file export first
      await this.exportToSingleFile(filePath);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid string length')) {
        console.log('Index too large for single file, using split-file approach...');
        await this.exportToSplitFiles(filePath);
      } else {
        throw error;
      }
    }
  }

  /**
   * Exports the index to a single file (original method)
   */
  private async exportToSingleFile(filePath: string): Promise<void> {
    const data: IndexData = {
      metadata: this.metadata || undefined,
      documents: Array.from(this.documents.values()),
      invertedIndex: Array.from(this.invertedIndex.entries()).map(([term, docIds]) => [term, Array.from(docIds)]),
    };

    const jsonData = JSON.stringify(data, null, 2);

    if (this.compress) {
      const compressedData = zlib.gzipSync(jsonData);
      await fs.promises.writeFile(filePath, compressedData);
    } else {
      await fs.promises.writeFile(filePath, jsonData);
    }
  }

  /**
   * Exports the index to multiple split files to handle very large indexes
   */
  private async exportToSplitFiles(filePath: string): Promise<void> {
    const basePath = filePath.replace(/\.[^/.]+$/, ''); // Remove extension
    const extension = filePath.match(/\.[^/.]+$/)?.[0] || '.json';

    // Create search-indexes directory
    const indexDir = 'search-indexes';
    if (!fs.existsSync(indexDir)) {
      await fs.promises.mkdir(indexDir, { recursive: true });
    }

    const baseFileName = basePath.split('/').pop() || basePath.split('\\').pop() || 'search-index';
    const indexBasePath = `${indexDir}/${baseFileName}`;

    // Export metadata - ensure we have valid metadata before export
    const metadataFile = `${indexBasePath}.metadata${extension}`;

    // If metadata is null or missing, create minimal metadata
    if (!this.metadata) {
      console.warn('Warning: Index metadata is missing, creating minimal metadata for export');
      this.metadata = {
        lastUpdated: new Date().toISOString(),
        totalFiles: this.documents.size,
        indexedFiles: {},
      };
    }

    const metadataData = {
      metadata: this.metadata,
      documentCount: this.documents.size,
      invertedIndexSize: this.invertedIndex.size,
      splitFiles: true,
    };
    await this.writeFile(metadataFile, JSON.stringify(metadataData, null, 2));

    // Export documents in chunks with aggressive memory management
    const docChunkSize = 200; // Much smaller chunks for large indexes
    let docChunkIndex = 0;
    let documentsProcessed = 0;
    const totalDocuments = this.documents.size;

    // Ensure clean line before starting progress
    process.stdout.write('\n');
    console.log(`Exporting ${totalDocuments} documents in chunks of ${docChunkSize}...`);

    // Use streaming approach instead of iterators to avoid memory buildup
    const documentIds = Array.from(this.documents.keys());

    for (let i = 0; i < documentIds.length; i += docChunkSize) {
      const chunk: SearchDocument[] = [];
      const endIndex = Math.min(i + docChunkSize, documentIds.length);

      // Process documents in current chunk
      for (let j = i; j < endIndex; j++) {
        const doc = this.documents.get(documentIds[j]);
        if (doc) {
          // Create a minimal document copy to reduce memory usage
          chunk.push({
            id: doc.id,
            title: doc.title,
            author: doc.author,
            excerpt: doc.excerpt,
            filePath: doc.filePath,
            type: doc.type,
            wordCount: doc.wordCount,
            tokenCount: doc.tokenCount,
          });
          documentsProcessed++;
        }
      }

      if (chunk.length > 0) {
        const docFile = `${indexBasePath}.docs.${docChunkIndex.toString().padStart(5, '0')}${extension}`;

        // Write and immediately clear chunk from memory
        const jsonData = JSON.stringify(chunk, null, 2);
        await this.writeFile(docFile, jsonData);
        docChunkIndex++;

        // Progress reporting with progress bar - update every 20 chunks or when 10% progress changes, or when complete
        const progressPercentage = Math.floor((documentsProcessed / totalDocuments) * 10) * 10; // Round to nearest 10%
        const lastProgressPercentage = Math.floor(((documentsProcessed - chunk.length) / totalDocuments) * 10) * 10;

        if (
          docChunkIndex % 20 === 0 ||
          progressPercentage > lastProgressPercentage ||
          documentsProcessed >= totalDocuments
        ) {
          updateProgress(documentsProcessed, totalDocuments, 'Exporting documents');

          // Force garbage collection for large exports
          if (global.gc && docChunkIndex % 20 === 0) {
            global.gc();
          }
        }
      }

      // Clear references immediately
      chunk.length = 0;
    }

    // Export inverted index in chunks with aggressive memory management
    const indexChunkSize = 2000; // Much smaller chunks for large indexes
    let indexChunkIndex = 0;
    let indexEntriesProcessed = 0;
    const totalIndexEntries = this.invertedIndex.size;

    // Small delay to ensure clean separation from document export
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log(`Exporting ${totalIndexEntries} index terms in chunks of ${indexChunkSize}...`);

    // Use streaming approach for inverted index
    const indexKeys = Array.from(this.invertedIndex.keys());

    for (let i = 0; i < indexKeys.length; i += indexChunkSize) {
      const chunk: [string, string[]][] = [];
      const endIndex = Math.min(i + indexChunkSize, indexKeys.length);

      // Process index entries in current chunk
      for (let j = i; j < endIndex; j++) {
        const term = indexKeys[j];
        const docIds = this.invertedIndex.get(term);
        if (docIds && docIds.size > 0) {
          // Convert Set to Array only when needed
          chunk.push([term, Array.from(docIds)]);
          indexEntriesProcessed++;
        }
      }

      if (chunk.length > 0) {
        const indexFile = `${indexBasePath}.index.${indexChunkIndex.toString().padStart(5, '0')}${extension}`;

        // Write and immediately clear chunk from memory
        const jsonData = JSON.stringify(chunk, null, 2);
        await this.writeFile(indexFile, jsonData);
        indexChunkIndex++;

        // Progress reporting with progress bar - update every 100 chunks or when 10% progress changes, or when complete
        const progressPercentage = Math.floor((indexEntriesProcessed / totalIndexEntries) * 10) * 10; // Round to nearest 10%
        const lastProgressPercentage =
          Math.floor(((indexEntriesProcessed - chunk.length) / totalIndexEntries) * 10) * 10;

        if (
          indexChunkIndex % 100 === 0 ||
          progressPercentage > lastProgressPercentage ||
          indexEntriesProcessed >= totalIndexEntries
        ) {
          updateProgress(indexEntriesProcessed, totalIndexEntries, 'Exporting index terms');

          // Force garbage collection for large exports
          if (global.gc && indexChunkIndex % 20 === 0) {
            global.gc();
          }
        }
      }

      // Clear references immediately
      chunk.length = 0;
    }

    // Create a manifest file listing all chunks
    const manifestFile = `${indexBasePath}.manifest${extension}`;
    const manifest = {
      type: 'split-index',
      metadataFile: `${baseFileName}.metadata${extension}`,
      documentChunks: docChunkIndex,
      indexChunks: indexChunkIndex,
      totalDocuments: this.documents.size,
      totalTerms: this.invertedIndex.size,
      indexDirectory: indexDir,
    };
    await this.writeFile(manifestFile, JSON.stringify(manifest, null, 2));

    // Small delay to ensure progress bars don't interfere with final output
    await new Promise((resolve) => setTimeout(resolve, 50));
    console.log(`Index exported as ${indexChunkIndex + docChunkIndex + 2} split files in ${indexDir}/`);
  }

  /**
   * Helper method to write file with compression if enabled
   * Uses streaming compression for large files to avoid memory issues
   */
  private async writeFile(filePath: string, data: string): Promise<void> {
    if (this.compress) {
      // For large data, use streaming compression to avoid memory allocation issues
      if (data.length > 10 * 1024 * 1024) {
        // 10MB threshold
        return new Promise((resolve, reject) => {
          const writeStream = fs.createWriteStream(filePath);
          const gzipStream = zlib.createGzip();

          writeStream.on('error', reject);
          gzipStream.on('error', reject);
          writeStream.on('finish', resolve);

          gzipStream.pipe(writeStream);
          gzipStream.write(data);
          gzipStream.end();
        });
      } else {
        // For smaller files, use sync compression
        const compressedData = zlib.gzipSync(data);
        await fs.promises.writeFile(filePath, compressedData);
      }
    } else {
      await fs.promises.writeFile(filePath, data);
    }
  }

  /**
   * Imports the index from a file (handles both single files and split files)
   */
  async importFromFile(filePath: string): Promise<void> {
    // Check if this is a split file system by looking for manifest in search-indexes directory
    const basePath = filePath.replace(/\.[^/.]+$/, '');
    const extension = filePath.match(/\.[^/.]+$/)?.[0] || '.json';

    const baseFileName = basePath.split('/').pop() || basePath.split('\\').pop() || 'search-index';
    const indexDir = 'search-indexes';
    const indexBasePath = `${indexDir}/${baseFileName}`;
    const manifestFile = `${indexBasePath}.manifest${extension}`;

    if (fs.existsSync(manifestFile)) {
      await this.importFromSplitFiles(indexBasePath, extension);
    } else if (fs.existsSync(filePath)) {
      await this.importFromSingleFile(filePath);
    } else {
      throw new Error(`Index file not found: ${filePath}`);
    }
  }

  /**
   * Imports the index from a single file (original method)
   */
  private async importFromSingleFile(filePath: string): Promise<void> {
    const fileData = await fs.promises.readFile(filePath);
    let jsonData: string;

    // Try to decompress, if it fails assume it's uncompressed JSON
    try {
      jsonData = zlib.gunzipSync(fileData).toString('utf-8');
    } catch {
      // If decompression fails, assume it's uncompressed JSON
      jsonData = fileData.toString('utf-8');
    }

    const data: IndexData = JSON.parse(jsonData);

    // Clear existing data
    this.documents.clear();
    this.invertedIndex.clear();
    this.metadata = data.metadata || null;

    // Rebuild documents
    for (const doc of data.documents) {
      this.documents.set(doc.id, doc);
    }

    // Rebuild inverted index
    for (const [term, docIds] of data.invertedIndex) {
      this.invertedIndex.set(term, new Set(docIds));
    }
  }

  /**
   * Imports the index from split files
   */
  private async importFromSplitFiles(basePath: string, extension: string): Promise<void> {
    const manifestFile = `${basePath}.manifest${extension}`;

    let manifest;
    try {
      const manifestData = await this.readFile(manifestFile);

      // Check for empty manifest file
      if (!manifestData.trim()) {
        throw new Error(`Manifest file is empty: ${manifestFile}`);
      }

      manifest = JSON.parse(manifestData);
    } catch (error) {
      throw new Error(`Failed to load manifest file ${manifestFile}: ${(error as Error).message}`);
    }

    // Clear existing data
    this.documents.clear();
    this.invertedIndex.clear();

    // Load metadata
    const metadataFile = `${basePath}.metadata${extension}`;
    try {
      const metadataData = await this.readFile(metadataFile);

      // Skip empty metadata files
      if (!metadataData.trim()) {
        console.warn(`Warning: Metadata file is empty: ${metadataFile}`);
        this.metadata = null;
      } else {
        const metadata = JSON.parse(metadataData);
        this.metadata = metadata.metadata || null;
      }
    } catch (error) {
      console.warn(`Warning: Failed to load metadata file ${metadataFile}: ${(error as Error).message}`);
      this.metadata = null;
    }

    console.log(`Loading split index: ${manifest.totalDocuments} documents, ${manifest.totalTerms} terms`);

    // Load document chunks with zero-padded file names
    let skippedCorruptedDocFiles = 0;
    for (let i = 0; i < manifest.documentChunks; i++) {
      const docFile = `${basePath}.docs.${i.toString().padStart(5, '0')}${extension}`;
      try {
        const docData = await this.readFile(docFile);

        // Skip empty files
        if (!docData.trim()) {
          console.warn(`Warning: Skipping empty document file: ${docFile}`);
          skippedCorruptedDocFiles++;
          continue;
        }

        const docs: SearchDocument[] = JSON.parse(docData);

        for (const doc of docs) {
          this.documents.set(doc.id, doc);
        }
      } catch (error) {
        console.warn(`Warning: Skipping corrupted document file ${docFile}: ${(error as Error).message}`);
        skippedCorruptedDocFiles++;
        continue;
      }
    }

    // Load inverted index chunks with zero-padded file names
    let skippedCorruptedFiles = 0;
    for (let i = 0; i < manifest.indexChunks; i++) {
      const indexFile = `${basePath}.index.${i.toString().padStart(5, '0')}${extension}`;
      try {
        const indexData = await this.readFile(indexFile);

        // Skip empty files
        if (!indexData.trim()) {
          console.warn(`Warning: Skipping empty index file: ${indexFile}`);
          skippedCorruptedFiles++;
          continue;
        }

        const indexEntries: [string, string[]][] = JSON.parse(indexData);

        for (const [term, docIds] of indexEntries) {
          this.invertedIndex.set(term, new Set(docIds));
        }
      } catch (error) {
        console.warn(`Warning: Skipping corrupted index file ${indexFile}: ${(error as Error).message}`);
        skippedCorruptedFiles++;
        continue;
      }
    }

    console.log(`Loaded ${this.documents.size} documents and ${this.invertedIndex.size} terms from split files`);
    if (skippedCorruptedDocFiles > 0) {
      console.warn(`Warning: Skipped ${skippedCorruptedDocFiles} corrupted document files`);
    }
    if (skippedCorruptedFiles > 0) {
      console.warn(`Warning: Skipped ${skippedCorruptedFiles} corrupted index files`);
    }
  }

  /**
   * Helper method to read file with decompression if needed
   */
  private async readFile(filePath: string): Promise<string> {
    const fileData = await fs.promises.readFile(filePath);

    // Try to decompress, if it fails assume it's uncompressed
    try {
      return zlib.gunzipSync(fileData).toString('utf-8');
    } catch {
      return fileData.toString('utf-8');
    }
  }

  /**
   * Gets the index metadata
   */
  getMetadata(): IndexMetadata | null {
    return this.metadata;
  }

  /**
   * Sets the index metadata
   */
  setMetadata(metadata: IndexMetadata): void {
    this.metadata = metadata;
  }

  /**
   * Updates the index metadata with current state
   */
  updateMetadata(dataFileHash?: string): void {
    const indexedFiles: Record<string, string> = {};
    for (const doc of this.documents.values()) {
      try {
        const stats = fs.statSync(doc.filePath);
        indexedFiles[doc.filePath] = stats.mtime.toISOString();
      } catch {
        // File might not exist anymore, use current time as fallback
        indexedFiles[doc.filePath] = new Date().toISOString();
      }
    }

    this.metadata = {
      lastUpdated: new Date().toISOString(),
      totalFiles: this.documents.size,
      dataFileHash,
      indexedFiles,
    };
  }

  /**
   * Merges another index into this one by combining documents and inverted indexes
   */
  mergeIndex(otherIndex: SearchIndex): void {
    // Add all documents from the other index
    for (const doc of otherIndex.getAllDocuments()) {
      this.documents.set(doc.id, doc);
    }

    // Merge inverted indexes
    for (const [term, docIds] of otherIndex.invertedIndex) {
      if (!this.invertedIndex.has(term)) {
        this.invertedIndex.set(term, new Set());
      }
      for (const docId of docIds) {
        this.invertedIndex.get(term)!.add(docId);
      }
    }

    // Merge metadata if needed
    if (otherIndex.metadata && !this.metadata) {
      this.metadata = otherIndex.metadata;
    }
  }

  /**
   * Clears all documents from the index
   */
  clear(): void {
    this.documents.clear();
    this.invertedIndex.clear();
    this.metadata = null;
  }

  /**
   * Gets the total number of unique terms in the inverted index
   */
  getInvertedIndexTermCount(): number {
    return this.invertedIndex.size;
  }

  /**
   * Gets the top N most frequent terms in the inverted index
   */
  getTopFrequentTerms(limit: number = 3): Array<{ term: string; frequency: number }> {
    const termFrequencies: Array<{ term: string; frequency: number }> = [];

    for (const [term, docIds] of this.invertedIndex) {
      termFrequencies.push({
        term,
        frequency: docIds.size,
      });
    }

    // Sort by frequency descending
    termFrequencies.sort((a, b) => b.frequency - a.frequency);

    return termFrequencies.slice(0, limit);
  }

  /**
   * Gets comprehensive index statistics including percentiles
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
    const totalDocuments = this.documents.size;
    const totalTerms = this.invertedIndex.size;

    // Calculate total tokens across all documents
    let totalTokens = 0;
    for (const doc of this.documents.values()) {
      totalTokens += doc.tokenCount || 0;
    }

    const averageDocumentSize = totalDocuments > 0 ? Math.round(totalTokens / totalDocuments) : 0;

    // Get all term frequencies
    const termFrequencies: number[] = [];
    for (const docIds of this.invertedIndex.values()) {
      termFrequencies.push(docIds.size);
    }

    // Calculate average term frequency
    const averageTermFrequency =
      termFrequencies.length > 0
        ? Math.round((termFrequencies.reduce((sum, freq) => sum + freq, 0) / termFrequencies.length) * 100) / 100
        : 0;

    // Calculate singleton terms statistics
    const singletonTermsCount = termFrequencies.filter((freq) => freq === 1).length;
    const singletonTermsPercentage = totalTerms > 0 ? Math.round((singletonTermsCount / totalTerms) * 10000) / 100 : 0;

    // Calculate average term frequency without singleton terms (frequency = 1)
    const nonSingletonFrequencies = termFrequencies.filter((freq) => freq > 1);
    const averageTermFrequencyWithoutSingletons =
      nonSingletonFrequencies.length > 0
        ? Math.round(
            (nonSingletonFrequencies.reduce((sum, freq) => sum + freq, 0) / nonSingletonFrequencies.length) * 100,
          ) / 100
        : 0;

    // Sort frequencies for percentile calculation
    termFrequencies.sort((a, b) => a - b);
    const nonSingletonFrequenciesSorted = nonSingletonFrequencies.sort((a, b) => a - b);

    // Calculate percentiles (including singletons)
    const percentiles = this.calculatePercentiles(termFrequencies);

    // Calculate percentiles without singletons
    const percentilesWithoutSingletons = this.calculatePercentiles(nonSingletonFrequenciesSorted);

    // Get top terms with percentages
    const topTerms = this.getTopFrequentTerms(topK);
    const topTermsWithPercentages = topTerms.map((term) => ({
      ...term,
      percentage: totalDocuments > 0 ? Math.round((term.frequency / totalDocuments) * 10000) / 100 : 0,
    }));

    return {
      totalDocuments,
      totalTerms,
      totalTokens,
      averageDocumentSize,
      averageTermFrequency,
      averageTermFrequencyWithoutSingletons,
      singletonTermsCount,
      singletonTermsPercentage,
      termFrequencies,
      percentiles,
      percentilesWithoutSingletons,
      topTermsWithPercentages,
    };
  }

  /**
   * Calculates 25th, 50th, and 75th percentiles from sorted array
   */
  private calculatePercentiles(sortedArray: number[]): { p25: number; p50: number; p75: number } {
    if (sortedArray.length === 0) {
      return { p25: 0, p50: 0, p75: 0 };
    }

    const n = sortedArray.length;

    // Calculate percentile positions
    const p25Position = (n - 1) * 0.25;
    const p50Position = (n - 1) * 0.5;
    const p75Position = (n - 1) * 0.75;

    // Interpolate values at percentile positions
    const p25 = this.interpolatePercentile(sortedArray, p25Position);
    const p50 = this.interpolatePercentile(sortedArray, p50Position);
    const p75 = this.interpolatePercentile(sortedArray, p75Position);

    return { p25, p50, p75 };
  }

  /**
   * Interpolates value at a given position in sorted array
   */
  private interpolatePercentile(sortedArray: number[], position: number): number {
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);

    if (lowerIndex === upperIndex) {
      return sortedArray[lowerIndex];
    }

    const lowerValue = sortedArray[lowerIndex];
    const upperValue = sortedArray[upperIndex];
    const fraction = position - lowerIndex;

    return Math.round((lowerValue + (upperValue - lowerValue) * fraction) * 100) / 100;
  }
}
