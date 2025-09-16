/**
 * Search indexing utilities using a simple inverted index for full-text search.
 */

import * as fs from 'fs';
import { tokenizeForIndexing } from './tokenizer';

export interface SearchDocument {
  id: string;
  title?: string;
  author?: string;
  content: string;
  filePath: string;
  type: 'pdf' | 'epub';
}

export interface SearchResult {
  id: string;
  title?: string;
  author?: string;
  filePath: string;
  type: 'pdf' | 'epub';
  score: number;
  excerpt?: string;
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

  constructor() {
    // Simple inverted index
  }

  /**
   * Adds multiple documents to the search index in batch
   */
  addDocumentsBatch(docs: SearchDocument[]): void {
    for (const doc of docs) {
      this.addDocument(doc);
    }
  }

  /**
   * Updates multiple documents in the index
   */
  updateDocumentsBatch(updates: { id: string; doc: SearchDocument }[]): void {
    for (const update of updates) {
      this.updateDocument(update.doc);
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
  addDocument(doc: SearchDocument): void {
    this.documents.set(doc.id, doc);

    // Tokenize and index content
    const tokens = tokenizeForIndexing(doc.content);
    const uniqueTokens = new Set(tokens);

    for (const token of uniqueTokens) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token)!.add(doc.id);
    }

    // Also index title and author if present
    if (doc.title) {
      const titleTokens = tokenizeForIndexing(doc.title);
      for (const token of titleTokens) {
        if (!this.invertedIndex.has(token)) {
          this.invertedIndex.set(token, new Set());
        }
        this.invertedIndex.get(token)!.add(doc.id);
      }
    }

    if (doc.author) {
      const authorTokens = tokenizeForIndexing(doc.author);
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
  updateDocument(doc: SearchDocument): void {
    this.removeDocument(doc.id);
    this.addDocument(doc);
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
  search(query: string, limit: number = 20): SearchResult[] {
    const queryTokens = tokenizeForIndexing(query);
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

      // Create excerpt from content around the first match
      const excerpt = this.createExcerpt(doc.content, query);

      results.push({
        id: doc.id,
        title: doc.title,
        author: doc.author,
        filePath: doc.filePath,
        type: doc.type,
        score,
        excerpt,
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  /**
   * Creates a text excerpt around the search query
   */
  private createExcerpt(content: string, query: string, contextLength: number = 100): string {
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const queryIndex = lowerContent.indexOf(lowerQuery);

    if (queryIndex === -1) return '';

    const start = Math.max(0, queryIndex - contextLength);
    const end = Math.min(content.length, queryIndex + query.length + contextLength);

    let excerpt = content.substring(start, end);
    if (start > 0) excerpt = '...' + excerpt;
    if (end < content.length) excerpt = excerpt + '...';

    return excerpt;
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
   * Exports the index to a file
   */
  async exportToFile(filePath: string): Promise<void> {
    const data: IndexData = {
      metadata: this.metadata || undefined,
      documents: Array.from(this.documents.values()),
      invertedIndex: Array.from(this.invertedIndex.entries()).map(([term, docIds]) => [term, Array.from(docIds)]),
    };

    const jsonData = JSON.stringify(data, null, 2);
    await fs.promises.writeFile(filePath, jsonData, 'utf-8');
  }

  /**
   * Imports the index from a file
   */
  async importFromFile(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Index file not found: ${filePath}`);
    }

    const jsonData = await fs.promises.readFile(filePath, 'utf-8');
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
   * Clears all documents from the index
   */
  clear(): void {
    this.documents.clear();
    this.invertedIndex.clear();
    this.metadata = null;
  }
}
