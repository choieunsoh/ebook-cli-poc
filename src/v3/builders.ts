/**
 * Choice builder functions for creating user configuration objects.
 */

import {
  askBatchDir,
  askBatchSize,
  askDisplayWithoutMetadata,
  askFileType,
  askMetadataType,
  askSearchSource,
} from './prompts';
import { UserChoices } from './types';

/**
 * Creates choices for append operation.
 */
export async function createAppendChoices(): Promise<UserChoices> {
  const batchDir = await askBatchDir();
  return {
    updateType: 'append',
    fileType: 'both', // Not used for append
    metadataType: 'metadata', // Not used for append
    batchSize: 10, // Not used for append
    batchDir,
  };
}

/**
 * Creates choices for summarize operation.
 */
export async function createSummarizeChoices(): Promise<UserChoices> {
  const displayWithoutMetadata = await askDisplayWithoutMetadata();
  return {
    updateType: 'summarize',
    fileType: 'both', // Not used for summarize
    metadataType: 'metadata', // Not used for summarize
    batchSize: 10, // Not used for summarize
    displayWithoutMetadata,
  };
}

/**
 * Creates choices for search operation.
 */
export async function createSearchChoices(): Promise<UserChoices> {
  const searchSource = await askSearchSource();
  return {
    updateType: 'search',
    fileType: 'both', // Not used for search
    metadataType: 'metadata', // Not used for search
    batchSize: 10, // Not used for search
    searchSource,
    searchTerm: '', // Will be set by the search function
  };
}

/**
 * Creates choices for SQLite import operation.
 */
export async function createSQLiteImportChoices(): Promise<UserChoices> {
  return {
    updateType: 'import-sqlite',
    fileType: 'both', // Not used for SQLite import
    metadataType: 'metadata', // Not used for SQLite import
    batchSize: 10, // Not used for SQLite import
  };
}

/**
 * Creates choices for tokenize operation.
 */
export async function createTokenizeChoices(): Promise<UserChoices> {
  return {
    updateType: 'tokenize',
    fileType: 'both', // Not used for tokenize
    metadataType: 'metadata', // Not used for tokenize
    batchSize: 10, // Not used for tokenize
  };
}

/**
 * Creates choices for configure tokenization operation.
 */
export async function createConfigureTokenizationChoices(): Promise<UserChoices> {
  return {
    updateType: 'configure-tokenization',
    fileType: 'both', // Not used for configure-tokenization
    metadataType: 'metadata', // Not used for configure-tokenization
    batchSize: 10, // Not used for configure-tokenization
  };
}

/**
 * Creates choices for run SQL operation.
 */
export async function createRunSQLChoices(): Promise<UserChoices> {
  return {
    updateType: 'run-sql',
    fileType: 'both', // Not used for run-sql
    metadataType: 'metadata', // Not used for run-sql
    batchSize: 10, // Not used for run-sql
  };
}

/**
 * Creates choices for rank tokens operation.
 */
export async function createRankTokensChoices(): Promise<UserChoices> {
  return {
    updateType: 'rank-tokens',
    fileType: 'both', // Not used for rank-tokens
    metadataType: 'metadata', // Not used for rank-tokens
    batchSize: 10, // Not used for rank-tokens
  };
}

/**
 * File processing update types (subset of UpdateType)
 */
type FileProcessingUpdateType = 'diff' | 'full';

/**
 * Creates choices for file processing operations (diff and full).
 */
export async function createFileProcessingChoices(updateType: FileProcessingUpdateType): Promise<UserChoices> {
  const fileType = await askFileType();
  const metadataType = await askMetadataType();
  const batchSize = await askBatchSize();
  return {
    updateType,
    fileType,
    metadataType,
    batchSize,
  };
}
