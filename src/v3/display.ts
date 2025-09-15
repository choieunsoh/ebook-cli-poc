/**
 * Display and formatting functions for the ebook CLI tool.
 */

import chalk from 'chalk';
import figlet from 'figlet';
import { UserChoices } from './types';
import { getFileTypeDisplayName, getMetadataTypeDisplayName, getUpdateTypeDisplayName } from './utils';

/**
 * Displays the ASCII art banner with gradient colors.
 */
export function displayBanner(): void {
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
}

/**
 * Displays a formatted summary of the user's configuration choices.
 */
export function displayConfigurationSummary(choices: UserChoices, dataFilePath: string): void {
  const updateTypeDisplay = getUpdateTypeDisplayName(choices.updateType);

  console.log('\n✅ Configuration Complete!');
  console.log('===========================');
  console.log(`Update Type: ${updateTypeDisplay}`);

  displayOperationSpecificDetails(choices, dataFilePath);
  displayTechnicalValues(choices);
}

/**
 * Displays operation-specific details based on the update type.
 */
function displayOperationSpecificDetails(choices: UserChoices, dataFilePath: string): void {
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
  } else if (['diff', 'full'].includes(choices.updateType)) {
    console.log(`File Types: ${getFileTypeDisplayName(choices.fileType)}`);
    console.log(`Extraction: ${getMetadataTypeDisplayName(choices.metadataType)}`);
    console.log(`Batch Size: ${choices.batchSize} files per batch`);
  }
}

/**
 * Displays the technical values section.
 */
function displayTechnicalValues(choices: UserChoices): void {
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
  } else if (choices.updateType === 'tokenize') {
    console.log(`   Tokenization mode for search enhancement`);
  } else if (choices.updateType === 'configure-tokenization') {
    console.log(`   Interactive tokenization configuration mode`);
  } else if (choices.updateType === 'run-sql') {
    console.log(`   Interactive SQL query execution mode`);
  } else if (choices.updateType === 'rank-tokens') {
    console.log(`   Token occurrence ranking and analysis mode`);
  } else if (['diff', 'full'].includes(choices.updateType)) {
    console.log(`   fileType: '${choices.fileType}'`);
    console.log(`   metadataType: '${choices.metadataType}'`);
    console.log(`   batchSize: ${choices.batchSize}`);
  }
}
