/**
 * Interactive CLI tool for configuring ebook metadata extraction options.
 * Guides users through selecting update type, file types, and metadata extraction preferences.
 */

import chalk from 'chalk';
import figlet from 'figlet';
import * as fs from 'fs';
import inquirer from 'inquirer';
import * as path from 'path';
import { appendBatchResults } from '../appendBatchResult';
import { processFiles } from './fileProcessor';
import { searchByTitle, searchByTitleSQLite } from './searchData';
import { importToSQLite } from './sqliteImport';
import { summarizeData } from './summarizeData';
import { UserChoices } from './types';

/**
 * Prompts user to select the type of update operation.
 * @returns Promise resolving to the chosen update type
 */
async function askUpdateType(): Promise<'diff' | 'full' | 'append' | 'summarize' | 'search' | 'import-sqlite'> {
  const updateTypeChoices = [
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
    {
      name: 'Summarize Data (read and summarize data.json)',
      value: 'summarize' as const,
    },
    {
      name: 'Search by Title (search ebooks by title or filename)',
      value: 'search' as const,
    },
    {
      name: 'Import to SQLite (import data.json to SQLite database with deduplication)',
      value: 'import-sqlite' as const,
    },
  ];

  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'updateType',
      message: 'Select the type of update to perform:',
      choices: updateTypeChoices,
    },
  ]);

  return answer.updateType;
}

/**
 * Prompts user to select which file types to process.
 * @returns Promise resolving to the chosen file type
 */
async function askFileType(): Promise<'both' | 'pdf' | 'epub'> {
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
    },
  ]);

  return answer.fileType;
}

/**
 * Prompts user to select the scope of metadata extraction.
 * @returns Promise resolving to the chosen metadata type
 */
async function askMetadataType(): Promise<'file-metadata' | 'metadata' | 'metadata+cover'> {
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
    },
  ]);

  return answer.metadataType;
}

/**
 * Prompts user to enter the batch size for processing.
 * @returns Promise resolving to the chosen batch size
 */
async function askBatchSize(): Promise<number> {
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
 * @returns Promise resolving to the batch directory name
 */
async function askBatchDir(): Promise<string> {
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
 * @returns Promise resolving to the choice
 */
async function askDisplayWithoutMetadata(): Promise<boolean> {
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
 * @returns Promise resolving to the chosen search source
 */
async function askSearchSource(): Promise<'json' | 'sqlite'> {
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
    },
  ]);

  return answer.searchSource;
}

/**
 * Orchestrates the complete user interaction flow.
 * Asks all configuration questions in sequence.
 * @returns Promise resolving to complete user choices object
 */
async function getUserChoice(): Promise<UserChoices> {
  const updateType = await askUpdateType();
  let choices: UserChoices;

  if (updateType === 'append') {
    const batchDir = await askBatchDir();
    choices = {
      updateType,
      fileType: 'both', // Not used for append
      metadataType: 'metadata', // Not used for append
      batchSize: 10, // Not used for append
      batchDir,
    };
  } else if (updateType === 'summarize') {
    const displayWithoutMetadata = await askDisplayWithoutMetadata();
    choices = {
      updateType,
      fileType: 'both', // Not used for summarize
      metadataType: 'metadata', // Not used for summarize
      batchSize: 10, // Not used for summarize
      displayWithoutMetadata,
    };
  } else if (updateType === 'search') {
    const searchSource = await askSearchSource();
    choices = {
      updateType,
      fileType: 'both', // Not used for search
      metadataType: 'metadata', // Not used for search
      batchSize: 10, // Not used for search
      searchSource,
      searchTerm: '', // Will be set by the search function
    };
  } else if (updateType === 'import-sqlite') {
    choices = {
      updateType,
      fileType: 'both', // Not used for SQLite import
      metadataType: 'metadata', // Not used for SQLite import
      batchSize: 10, // Not used for SQLite import
    };
  } else {
    const fileType = await askFileType();
    const metadataType = await askMetadataType();
    const batchSize = await askBatchSize();
    choices = {
      updateType,
      fileType,
      metadataType,
      batchSize,
    };
  }

  return choices;
}

/**
 * Main application entry point.
 * Displays welcome message, collects user preferences, and shows summary.
 */
async function main() {
  // Display ASCII art banner with gradient
  const bannerText = figlet.textSync('Ebook Tool', {
    font: 'Standard',
    horizontalLayout: 'default',
    verticalLayout: 'default',
  });
  const lines = bannerText.split('\n');
  const startColor = [0, 123, 255]; // Blue
  const endColor = [255, 0, 255]; // Magenta
  const totalLines = lines.length;

  lines.forEach((line, index) => {
    const ratio = index / (totalLines - 1);
    const r = Math.round(startColor[0] + (endColor[0] - startColor[0]) * ratio);
    const g = Math.round(startColor[1] + (endColor[1] - startColor[1]) * ratio);
    const b = Math.round(startColor[2] + (endColor[2] - startColor[2]) * ratio);
    console.log(chalk.rgb(r, g, b)(line));
  });

  console.log('📚 Ebook Metadata Extraction Tool');
  console.log('==================================');
  console.log('This tool helps you configure metadata extraction for your ebook collection.\n');

  try {
    const choices = await getUserChoice();

    // Load config for dataFile
    const configPath = path.join(process.cwd(), 'config.json');
    const configData = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configData);
    const dataFilePath = path.join(process.cwd(), config.outputDir, config.dataFile ?? 'data.json');

    // Format display names for summary
    let updateTypeDisplay: string;
    if (choices.updateType === 'append') {
      updateTypeDisplay = 'Append Batch Results';
    } else if (choices.updateType === 'summarize') {
      updateTypeDisplay = 'Summarize Data';
    } else if (choices.updateType === 'search') {
      updateTypeDisplay = 'Search by Title';
    } else if (choices.updateType === 'import-sqlite') {
      updateTypeDisplay = 'Import to SQLite Database';
    } else {
      updateTypeDisplay =
        choices.updateType === 'diff' ? 'Incremental Update (new/changed files only)' : 'Full Scan (all files)';
    }

    const fileTypeDisplay =
      choices.fileType === 'both'
        ? 'All ebooks (PDF + EPUB)'
        : choices.fileType === 'pdf'
          ? 'PDF files only'
          : 'EPUB files only';

    const metadataTypeDisplay =
      choices.metadataType === 'file-metadata'
        ? 'File metadata only'
        : choices.metadataType === 'metadata'
          ? 'Ebook metadata only'
          : 'Ebook metadata + Cover Images';

    console.log('\n✅ Configuration Complete!');
    console.log('===========================');
    console.log(`Update Type: ${updateTypeDisplay}`);
    if (choices.updateType === 'append') {
      console.log(`Batch Directory: ${choices.batchDir}`);
      console.log(`Data File: ${dataFilePath}`);
    } else if (choices.updateType === 'summarize') {
      console.log(`Display without metadata: ${choices.displayWithoutMetadata ? 'Yes' : 'No'}`);
    } else if (choices.updateType === 'search') {
      const searchSourceDisplay = choices.searchSource === 'sqlite' ? 'SQLite Database' : 'JSON File (data.json)';
      console.log(`Search Source: ${searchSourceDisplay}`);
      console.log(`Interactive Search: Will prompt for search terms`);
    } else if (choices.updateType === 'import-sqlite') {
      console.log(`Database Import: Will import data.json to SQLite with deduplication`);
    } else {
      console.log(`File Types: ${fileTypeDisplay}`);
      console.log(`Extraction: ${metadataTypeDisplay}`);
      console.log(`Batch Size: ${choices.batchSize} files per batch`);
    }
    console.log('\n📋 Technical Values:');
    console.log(`   updateType: '${choices.updateType}'`);
    if (choices.updateType === 'append') {
      console.log(`   batchDir: '${choices.batchDir}'`);
    } else if (choices.updateType === 'summarize') {
      console.log(`   displayWithoutMetadata: ${choices.displayWithoutMetadata}`);
    } else if (choices.updateType === 'search') {
      console.log(`   searchSource: '${choices.searchSource}'`);
      console.log(`   Interactive search mode`);
    } else if (choices.updateType === 'import-sqlite') {
      console.log(`   SQLite database import mode`);
    } else {
      console.log(`   fileType: '${choices.fileType}'`);
      console.log(`   metadataType: '${choices.metadataType}'`);
      console.log(`   batchSize: ${choices.batchSize}`);
    }

    // Process based on updateType
    if (choices.updateType === 'append') {
      appendBatchResults(choices.batchDir!, dataFilePath);
    } else if (choices.updateType === 'summarize') {
      summarizeData(dataFilePath, choices.displayWithoutMetadata || false);
    } else if (choices.updateType === 'search') {
      if (choices.searchSource === 'sqlite') {
        const dbPath = path.join(path.dirname(dataFilePath), 'ebooks.db');
        await searchByTitleSQLite(dbPath);
      } else {
        await searchByTitle(dataFilePath, '');
      }
    } else if (choices.updateType === 'import-sqlite') {
      await importToSQLite(dataFilePath);
    } else {
      // Generate session timestamp for batch directory naming
      const now = new Date();
      const sessionTimestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);

      await processFiles(choices, sessionTimestamp);

      // Automatically append batch results after processing
      const batchDir = `batches-${sessionTimestamp}`;
      console.log(`\n💾 Appending batch results from: ${batchDir}`);
      appendBatchResults(batchDir, dataFilePath);
    }
  } catch (error) {
    console.error('❌ An error occurred during configuration:', (error as Error).message);
    process.exit(1);
  }
}

// Start the application
main();
