/**
 * Search indexing utilities using a simple inverted index for full-text search.
 */

import * as fs from 'fs';
import * as zlib from 'zlib';
import { tokenizeForIndexing, tokenizeMetadataForIndexing } from './tokenizer';

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
   */
  async exportToFile(filePath: string): Promise<void> {
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
   * Imports the index from a file (handles both compressed and uncompressed)
   */
  async importFromFile(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Index file not found: ${filePath}`);
    }

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
}
