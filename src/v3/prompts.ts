/**
 * User interaction and prompt functions for the ebook CLI tool.
 */

import inquirer from 'inquirer';

/**
 * Prompts user to select from quick actions or advanced options.
 */
export async function askQuickAction(): Promise<'quick-process' | 'quick-search' | 'quick-summarize' | 'advanced'> {
  const quickActionChoices = [
    {
      name: '🔄 Process my ebooks (incremental)',
      value: 'quick-process' as const,
    },
    {
      name: '🔍 Search my collection',
      value: 'quick-search' as const,
    },
    {
      name: '📊 Show summary',
      value: 'quick-summarize' as const,
    },
    {
      name: '⚙️  Advanced Options...',
      value: 'advanced' as const,
    },
  ];

  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'quickAction',
      message: 'What would you like to do?',
      choices: quickActionChoices,
      pageSize: quickActionChoices.length,
    },
  ]);

  return answer.quickAction;
}

/**
 * Prompts user to select from advanced options with grouped categories.
 */
export async function askAdvancedUpdateType(): Promise<
  | 'diff'
  | 'full'
  | 'append'
  | 'summarize'
  | 'search'
  | 'import-sqlite'
  | 'tokenize'
  | 'configure-tokenization'
  | 'run-sql'
  | 'rank-tokens'
  | 'back'
> {
  const advancedChoices = [
    new inquirer.Separator('📁 FILE PROCESSING'),
    {
      name: 'Incremental Update (process only new or changed files)',
      value: 'diff' as const,
    },
    {
      name: 'Full Scan (process all files from scratch)',
      value: 'full' as const,
    },
    {
      name: 'Append Batch Results (append batch files to data.json)',
      value: 'append' as const,
    },
    new inquirer.Separator('🔍 DATA ANALYSIS & SEARCH'),
    {
      name: 'Summarize Data (read and summarize data.json)',
      value: 'summarize' as const,
    },
    {
      name: 'Search by Title (search ebooks by title or filename)',
      value: 'search' as const,
    },
    {
      name: 'Rank Token Occurrences (analyze and rank most used tokens)',
      value: 'rank-tokens' as const,
    },
    new inquirer.Separator('🗄️  DATABASE OPERATIONS'),
    {
      name: 'Import to SQLite (import data.json to SQLite database)',
      value: 'import-sqlite' as const,
    },
    {
      name: 'Run SQL Query (execute custom SQL commands)',
      value: 'run-sql' as const,
    },
    new inquirer.Separator('⚙️  SEARCH ENHANCEMENT'),
    {
      name: 'Tokenize Titles/Filenames (add tokenized data for search)',
      value: 'tokenize' as const,
    },
    {
      name: 'Configure Tokenization Settings (customize options)',
      value: 'configure-tokenization' as const,
    },
    new inquirer.Separator('⬅️  NAVIGATION'),
    {
      name: '← Back to Main Menu',
      value: 'back' as const,
    },
  ];

  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'updateType',
      message: 'Advanced Options - Select the type of update to perform:',
      choices: advancedChoices,
      pageSize: advancedChoices.length,
    },
  ]);

  return answer.updateType;
}

/**
 * Prompts user to select which file types to process.
 */
export async function askFileType(): Promise<'both' | 'pdf' | 'epub'> {
  const fileTypeChoices = [
    {
      name: 'All ebooks (PDF and EPUB files)',
      value: 'both' as const,
    },
    {
      name: 'PDF files only',
      value: 'pdf' as const,
    },
    {
      name: 'EPUB files only',
      value: 'epub' as const,
    },
  ];

  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'fileType',
      message: 'Choose which file types to process:',
      choices: fileTypeChoices,
      pageSize: fileTypeChoices.length,
    },
  ]);

  return answer.fileType;
}

/**
 * Prompts user to select the scope of metadata extraction.
 */
export async function askMetadataType(): Promise<'file-metadata' | 'metadata' | 'metadata+cover'> {
  const metadataTypeChoices = [
    {
      name: 'Ebook metadata only (title, author, description, etc.)',
      value: 'metadata' as const,
    },
    {
      name: 'Ebook metadata and cover images',
      value: 'metadata+cover' as const,
    },
    {
      name: 'File metadata only (size, dates, path)',
      value: 'file-metadata' as const,
    },
  ];

  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'metadataType',
      message: 'Select what to extract from the ebooks:',
      choices: metadataTypeChoices,
      pageSize: metadataTypeChoices.length,
    },
  ]);

  return answer.metadataType;
}

/**
 * Prompts user to enter the batch size for processing.
 */
export async function askBatchSize(): Promise<number> {
  const answer = await inquirer.prompt([
    {
      type: 'input',
      name: 'batchSize',
      message: 'Enter the number of files to process in each batch:',
      default: '10',
      validate: (input: string) => {
        const num = Number(input);
        if (isNaN(num) || num <= 0) {
          return 'Batch size must be a positive number';
        }
        if (num > 100) {
          return 'Batch size should not exceed 100 for performance reasons';
        }
        return true;
      },
    },
  ]);

  return Number(answer.batchSize);
}

/**
 * Prompts user to enter the batch directory name.
 */
export async function askBatchDir(): Promise<string> {
  const answer = await inquirer.prompt([
    {
      type: 'input',
      name: 'batchDir',
      message: 'Enter the batch directory name (e.g., batches-2025-09-15_00-26-02):',
      validate: (input: string) => {
        if (!input.trim()) {
          return 'Batch directory name cannot be empty';
        }
        return true;
      },
    },
  ]);

  return answer.batchDir.trim();
}

/**
 * Prompts user to choose whether to display files without metadata.
 */
export async function askDisplayWithoutMetadata(): Promise<boolean> {
  const answer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'displayWithoutMetadata',
      message: 'Do you want to display the list of files without metadata?',
      default: false,
    },
  ]);

  return answer.displayWithoutMetadata;
}

/**
 * Prompts user to choose the search source.
 */
export async function askSearchSource(): Promise<'json' | 'sqlite'> {
  const searchSourceChoices = [
    {
      name: 'Search from data.json (JSON file)',
      value: 'json' as const,
    },
    {
      name: 'Search from SQLite database',
      value: 'sqlite' as const,
    },
  ];

  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'searchSource',
      message: 'Choose where to search for ebooks:',
      choices: searchSourceChoices,
      pageSize: searchSourceChoices.length,
    },
  ]);

  return answer.searchSource;
}
