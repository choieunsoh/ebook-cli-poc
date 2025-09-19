/**
 * Tokenization utilities for text processing in full-text search.
 */

import * as natural from 'natural';
import { eng, removeStopwords } from 'stopword';
import { isBERTAvailable, tokenizeForBERTSearch } from './bertTokenizer';

export interface TokenizationResult {
  tokens: string[];
  stemmedTokens?: string[];
  filteredTokens?: string[];
}

/**
 * Preprocesses metadata strings to split on common programming naming conventions
 * Handles dots, underscores, hyphens, camelCase, PascalCase, and version numbers
 */
export function preprocessMetadataForTokenization(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let processed = text;

  // Handle camelCase and PascalCase by inserting spaces before capital letters
  // But avoid splitting at the beginning of words or after spaces/numbers
  processed = processed.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

  // Split on dots (but be careful with version numbers and abbreviations)
  processed = processed.replace(/\.+/g, ' ');

  // Split on underscores
  processed = processed.replace(/_+/g, ' ');

  // Split on hyphens
  processed = processed.replace(/-+/g, ' ');

  // Handle version patterns like v1.2.3, 2.0, etc.
  processed = processed.replace(/(\d+)\.(\d+)/g, '$1 $2');

  // Handle mixed alphanumeric patterns like abc123def -> abc 123 def
  processed = processed.replace(/([a-zA-Z])(\d+)/g, '$1 $2');
  processed = processed.replace(/(\d+)([a-zA-Z])/g, '$1 $2');

  // Clean up multiple spaces
  processed = processed.replace(/\s+/g, ' ').trim();

  return processed;
}

/**
 * Tokenizes text into words using natural language processing
 */
export function tokenizeText(text: string): TokenizationResult {
  // Use natural's WordTokenizer for basic tokenization
  const tokenizer = new natural.WordTokenizer();
  const tokens = tokenizer.tokenize(text) || [];

  // Filter out very short tokens and non-alphabetic tokens (but allow some technical chars)
  const filteredTokens = tokens.filter((token: string) => {
    // Keep tokens that are 3+ characters and contain at least some letters
    return token.length >= 3 && /[a-zA-Z]/.test(token);
  });

  // Apply stemming using Porter Stemmer
  const stemmedTokens = filteredTokens.map((token: string) => natural.PorterStemmer.stem(token.toLowerCase()));

  return {
    tokens,
    filteredTokens,
    stemmedTokens,
  };
}

/**
 * Advanced tokenization with BERT support and stop word removal
 */
export async function tokenizeTextAdvanced(
  text: string,
  useBERT: boolean = false,
  bertModel?: string,
): Promise<TokenizationResult> {
  if (useBERT) {
    try {
      // Check if BERT is available
      const bertAvailable = await isBERTAvailable(bertModel);
      if (bertAvailable) {
        const bertTokens = await tokenizeForBERTSearch(text, bertModel);
        return {
          tokens: bertTokens,
          filteredTokens: bertTokens,
          stemmedTokens: bertTokens, // BERT tokens are already subword tokens
        };
      } else {
        console.warn('⚠️ BERT tokenizer not available, falling back to basic tokenization');
      }
    } catch (error) {
      console.warn('⚠️ BERT tokenization failed, falling back to basic tokenization:', error);
    }
  }

  // Fallback to basic tokenization
  return tokenizeTextBasic(text);
}

/**
 * Basic tokenization with stop word removal and normalization
 */
export function tokenizeTextBasic(text: string): TokenizationResult {
  // Basic tokenization
  const basic = tokenizeText(text);

  // Use stopword library for better performance and maintainability
  const withoutStopWords = removeStopwords(basic.filteredTokens!, eng);

  // Normalize to lowercase
  const normalizedTokens = withoutStopWords.map((token: string) => token.toLowerCase());

  // Remove duplicates while preserving order
  const uniqueTokens = [...new Set(normalizedTokens)];

  return {
    tokens: basic.tokens,
    filteredTokens: uniqueTokens,
    stemmedTokens: uniqueTokens.map((token: string) => natural.PorterStemmer.stem(token)),
  };
}

/**
 * Tokenizes text for search indexing (optimized for search with stop word filtering)
 */
export async function tokenizeForIndexing(
  text: string,
  useBERT: boolean = false,
  bertModel?: string,
): Promise<string[]> {
  const result = await tokenizeTextAdvanced(text, useBERT, bertModel);
  return result.stemmedTokens || [];
}

/**
 * Tokenizes a search query (same processing as indexing)
 */
export async function tokenizeQuery(query: string, useBERT: boolean = false, bertModel?: string): Promise<string[]> {
  return tokenizeForIndexing(query, useBERT, bertModel);
}

/**
 * Tokenizes metadata (titles, authors) for search indexing with preprocessing
 * for programming naming conventions (dots, underscores, camelCase, etc.)
 */
export async function tokenizeMetadataForIndexing(
  text: string,
  useBERT: boolean = false,
  bertModel?: string,
): Promise<string[]> {
  // First preprocess the metadata to split on naming conventions
  const preprocessed = preprocessMetadataForTokenization(text);

  // Then tokenize the preprocessed text
  const result = await tokenizeTextAdvanced(preprocessed, useBERT, bertModel);
  return result.stemmedTokens || [];
}
