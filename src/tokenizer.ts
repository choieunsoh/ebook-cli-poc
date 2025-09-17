/**
 * Tokenization utilities for text processing in full-text search.
 */

import * as natural from 'natural';

export interface TokenizationResult {
  tokens: string[];
  stemmedTokens?: string[];
  filteredTokens?: string[];
}

/**
 * Tokenizes text into words using natural language processing
 */
export function tokenizeText(text: string): TokenizationResult {
  // Use natural's WordTokenizer for basic tokenization
  const tokenizer = new natural.WordTokenizer();
  const tokens = tokenizer.tokenize(text) || [];

  // Filter out very short tokens and non-alphabetic tokens
  const filteredTokens = tokens.filter((token) => token.length > 2 && /^[a-zA-Z]+$/.test(token));

  // Apply stemming using Porter Stemmer
  const stemmedTokens = filteredTokens.map((token) => natural.PorterStemmer.stem(token.toLowerCase()));

  return {
    tokens,
    filteredTokens,
    stemmedTokens,
  };
}

/**
 * Advanced tokenization with stop word removal and normalization
 */
export function tokenizeTextAdvanced(text: string): TokenizationResult {
  // Basic tokenization
  const basic = tokenizeText(text);

  // Remove stop words
  const stopWords = new Set(natural.stopwords);
  const withoutStopWords = basic.filteredTokens!.filter((token) => !stopWords.has(token.toLowerCase()));

  // Normalize to lowercase
  const normalizedTokens = withoutStopWords.map((token) => token.toLowerCase());

  // Remove duplicates while preserving order
  const uniqueTokens = [...new Set(normalizedTokens)];

  return {
    tokens: basic.tokens,
    filteredTokens: uniqueTokens,
    stemmedTokens: uniqueTokens.map((token) => natural.PorterStemmer.stem(token)),
  };
}

/**
 * Tokenizes text for search indexing (optimized for search with stop word filtering)
 */
export function tokenizeForIndexing(text: string): string[] {
  const result = tokenizeTextAdvanced(text);
  return result.stemmedTokens || [];
}

/**
 * Tokenizes a search query (same processing as indexing)
 */
export function tokenizeQuery(query: string): string[] {
  return tokenizeForIndexing(query);
}
