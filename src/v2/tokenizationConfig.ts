/**
 * Tokenization configuration utilities for the ebook CLI tool.
 * Handles interactive configuration of tokenization settings.
 */

import * as fs from 'fs';
import inquirer from 'inquirer';
import * as path from 'path';

/**
 * Prompts user to configure tokenization settings interactively.
 * @returns Promise that resolves when configuration is complete
 */
export async function configureTokenization(): Promise<void> {
  console.log('\n🔧 Tokenization Configuration');
  console.log('=============================');

  // Load current config
  const configPath = path.join(process.cwd(), 'config.json');
  const configData = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configData);

  // Get current tokenization settings or defaults
  const currentTokenization = config.tokenization || {
    enabled: true,
    minTokenLength: 2,
    maxTokenLength: 50,
    removeStopwords: true,
    useStemming: true,
    customStopwords: [],
    fieldsToTokenize: ['title', 'filename'],
  };

  console.log('Current settings:');
  console.log(`  Enabled: ${currentTokenization.enabled}`);
  console.log(`  Min Token Length: ${currentTokenization.minTokenLength}`);
  console.log(`  Max Token Length: ${currentTokenization.maxTokenLength}`);
  console.log(`  Remove Stopwords: ${currentTokenization.removeStopwords}`);
  console.log(`  Use Stemming: ${currentTokenization.useStemming}`);
  console.log(`  Custom Stopwords: ${currentTokenization.customStopwords.join(', ') || 'None'}`);
  console.log(`  Fields to Tokenize: ${currentTokenization.fieldsToTokenize.join(', ')}`);
  console.log('');

  // Ask for each setting individually to avoid type conflicts
  const enabledAnswer = await inquirer.prompt({
    type: 'confirm',
    name: 'enabled',
    message: 'Enable tokenization?',
    default: currentTokenization.enabled,
  });

  const minTokenLengthAnswer = await inquirer.prompt({
    type: 'number',
    name: 'minTokenLength',
    message: 'Minimum token length (characters):',
    default: currentTokenization.minTokenLength,
    validate: (value: number | undefined) => {
      if (value === undefined || value < 1) return 'Minimum token length must be at least 1';
      return true;
    },
  });

  const maxTokenLengthAnswer = await inquirer.prompt({
    type: 'number',
    name: 'maxTokenLength',
    message: 'Maximum token length (characters):',
    default: currentTokenization.maxTokenLength,
    validate: (value: number | undefined) => {
      if (value === undefined || value < 1) return 'Maximum token length must be at least 1';
      return true;
    },
  });

  const removeStopwordsAnswer = await inquirer.prompt({
    type: 'confirm',
    name: 'removeStopwords',
    message: 'Remove common stopwords (the, and, or, etc.)?',
    default: currentTokenization.removeStopwords,
  });

  const useStemmingAnswer = await inquirer.prompt({
    type: 'confirm',
    name: 'useStemming',
    message: 'Use stemming (reduce words to root form)?',
    default: currentTokenization.useStemming,
  });

  const customStopwordsAnswer = await inquirer.prompt({
    type: 'input',
    name: 'customStopwords',
    message: 'Custom stopwords (comma-separated, leave empty for none):',
    default: currentTokenization.customStopwords.join(', '),
  });

  const fieldsToTokenizeAnswer = await inquirer.prompt({
    type: 'checkbox',
    name: 'fieldsToTokenize',
    message: 'Fields to tokenize:',
    choices: [
      { name: 'Title', value: 'title', checked: currentTokenization.fieldsToTokenize.includes('title') },
      { name: 'Filename', value: 'filename', checked: currentTokenization.fieldsToTokenize.includes('filename') },
    ],
  });

  // Combine answers
  const answers = {
    enabled: enabledAnswer.enabled,
    minTokenLength: minTokenLengthAnswer.minTokenLength,
    maxTokenLength: maxTokenLengthAnswer.maxTokenLength,
    removeStopwords: removeStopwordsAnswer.removeStopwords,
    useStemming: useStemmingAnswer.useStemming,
    customStopwords: customStopwordsAnswer.customStopwords,
    fieldsToTokenize: fieldsToTokenizeAnswer.fieldsToTokenize,
  };

  // Process custom stopwords
  const customStopwords = answers.customStopwords
    ? answers.customStopwords
        .split(',')
        .map((word: string) => word.trim())
        .filter((word: string) => word.length > 0)
    : [];

  // Update config
  const newTokenization = {
    enabled: answers.enabled,
    minTokenLength: answers.minTokenLength,
    maxTokenLength: answers.maxTokenLength,
    removeStopwords: answers.removeStopwords,
    useStemming: answers.useStemming,
    customStopwords,
    fieldsToTokenize: answers.fieldsToTokenize,
  };

  config.tokenization = newTokenization;

  // Save config
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log('\n✅ Tokenization configuration updated!');
  console.log('New settings:');
  console.log(`  Enabled: ${newTokenization.enabled}`);
  console.log(`  Min Token Length: ${newTokenization.minTokenLength}`);
  console.log(`  Max Token Length: ${newTokenization.maxTokenLength}`);
  console.log(`  Remove Stopwords: ${newTokenization.removeStopwords}`);
  console.log(`  Use Stemming: ${newTokenization.useStemming}`);
  console.log(`  Custom Stopwords: ${newTokenization.customStopwords.join(', ') || 'None'}`);
  console.log(`  Fields to Tokenize: ${newTokenization.fieldsToTokenize.join(', ')}`);
}
