/**
 * Operation handler functions for processing different update types.
 */

import inquirer from 'inquirer';
import * as path from 'path';
import { appendBatchResults } from '../appendBatchResult';
import { processFiles } from '../v2/fileProcessor';
import { searchByTitle, searchByTitleSQLite } from '../v2/searchData';
import { importToSQLite } from '../v2/sqliteImport';
import { runSQLQuery } from '../v2/sqlQueryExecutor';
import { summarizeData } from '../v2/summarizeData';
import { configureTokenization } from '../v2/tokenizationConfig';
import { tokenizeData } from '../v2/tokenizeData';
import { rankTokensInteractive } from '../v2/tokenRanking';
import { UserChoices } from './types';

/**
 * Processes the user's choice and executes the appropriate action.
 */
export async function processUserChoice(choices: UserChoices, dataFilePath: string): Promise<boolean> {
  const operationHandlers = {
    append: () => handleAppendOperation(choices, dataFilePath),
    summarize: () => handleSummarizeOperation(choices, dataFilePath),
    search: () => handleSearchOperation(choices, dataFilePath),
    'import-sqlite': () => handleSQLiteImportOperation(dataFilePath),
    tokenize: () => handleTokenizeOperation(dataFilePath),
    'configure-tokenization': () => handleConfigureTokenizationOperation(),
    'run-sql': () => handleRunSQLOperation(),
    'rank-tokens': () => handleRankTokensOperation(dataFilePath),
    diff: () => handleFileProcessingOperation(choices, dataFilePath),
    full: () => handleFileProcessingOperation(choices, dataFilePath),
  };

  const handler = operationHandlers[choices.updateType];
  if (handler) {
    return await handler();
  }

  throw new Error(`Unknown update type: ${choices.updateType}`);
}

/**
 * Handles the append batch results operation.
 */
async function handleAppendOperation(choices: UserChoices, dataFilePath: string): Promise<boolean> {
  appendBatchResults(choices.batchDir!, dataFilePath);
  return false; // Exit after processing
}

/**
 * Handles the summarize data operation.
 */
async function handleSummarizeOperation(choices: UserChoices, dataFilePath: string): Promise<boolean> {
  summarizeData(dataFilePath, choices.displayWithoutMetadata || false);
  return false; // Exit after processing
}

/**
 * Handles the search operation.
 */
async function handleSearchOperation(choices: UserChoices, dataFilePath: string): Promise<boolean> {
  if (choices.searchSource === 'sqlite') {
    const dbPath = path.join(path.dirname(dataFilePath), 'ebooks.db');
    await searchByTitleSQLite(dbPath);
  } else {
    await searchByTitle(dataFilePath, '');
  }
  // Continue running - user can go back to menu
  console.log('\n🔄 Returning to main menu...\n');
  return true;
}

/**
 * Handles the SQLite import operation.
 */
async function handleSQLiteImportOperation(dataFilePath: string): Promise<boolean> {
  await importToSQLite(dataFilePath);
  return false; // Exit after processing
}

/**
 * Handles the tokenization operation.
 */
async function handleTokenizeOperation(dataFilePath: string): Promise<boolean> {
  console.log('🔍 Starting tokenization of titles and filenames...');
  await tokenizeData(dataFilePath);
  console.log('✅ Tokenization complete!');
  return false; // Exit after processing
}

/**
 * Handles the configure tokenization operation.
 */
async function handleConfigureTokenizationOperation(): Promise<boolean> {
  console.log('⚙️  Starting tokenization configuration...');
  await configureTokenization();
  console.log('✅ Tokenization configuration complete!');
  return false; // Exit after processing
}

/**
 * Handles the run SQL operation.
 */
async function handleRunSQLOperation(): Promise<boolean> {
  console.log('🗄️  Starting SQL query executor...');
  await runSQLQuery();
  console.log('✅ SQL session complete!');
  // Continue running - user can go back to menu
  console.log('\n🔄 Returning to main menu...\n');
  return true;
}

/**
 * Handles the rank tokens operation.
 */
async function handleRankTokensOperation(dataFilePath: string): Promise<boolean> {
  console.log('📊 Starting token ranking analysis...');
  await rankTokensInteractive(dataFilePath);
  console.log('✅ Token ranking complete!');
  return false; // Exit after processing
}

/**
 * Handles file processing operations (diff and full).
 */
async function handleFileProcessingOperation(choices: UserChoices, dataFilePath: string): Promise<boolean> {
  // Generate session timestamp for batch directory naming
  const now = new Date();
  const sessionTimestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);

  await processFiles(choices, sessionTimestamp);

  // Automatically append batch results after processing
  const batchDir = `batches-${sessionTimestamp}`;
  console.log(`\n💾 Appending batch results from: ${batchDir}`);
  appendBatchResults(batchDir, dataFilePath);

  // Handle post-processing options
  return await handlePostProcessing(dataFilePath);
}

/**
 * Handles post-processing options like tokenization and SQLite import.
 */
async function handlePostProcessing(dataFilePath: string): Promise<boolean> {
  // Ask if user wants to import to SQLite
  const sqliteAnswer = await inquirer.prompt({
    type: 'confirm',
    name: 'runSQLite',
    message: 'Would you like to import the data to SQLite database?',
    default: true,
  });

  if (sqliteAnswer.runSQLite) {
    console.log('\n🗄️  Starting SQLite import...');
    await importToSQLite(dataFilePath);
    console.log('✅ SQLite import complete!');
  }

  // Ask if user wants to run tokenization
  const tokenizeAnswer = await inquirer.prompt({
    type: 'confirm',
    name: 'runTokenize',
    message: 'Would you like to run tokenization on the processed data for enhanced search?',
    default: true,
  });

  if (tokenizeAnswer.runTokenize) {
    console.log('\n🔍 Starting tokenization of titles and filenames...');
    await tokenizeData(dataFilePath);
    console.log('✅ Tokenization complete!');
  }

  return false; // Exit after processing
}
