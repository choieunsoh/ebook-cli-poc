/**
 * Main workflow orchestration functions for the ebook CLI tool.
 */

import {
  createAppendChoices,
  createConfigureTokenizationChoices,
  createFileProcessingChoices,
  createRankTokensChoices,
  createRunSQLChoices,
  createSearchChoices,
  createSQLiteImportChoices,
  createSummarizeChoices,
  createTokenizeChoices,
} from './builders';
import { askAdvancedUpdateType, askQuickAction } from './prompts';
import { UserChoices } from './types';
import { mapQuickActionToUpdateType } from './utils';

/**
 * Orchestrates the complete user interaction flow.
 * Asks all configuration questions in sequence.
 */
export async function getUserChoice(): Promise<UserChoices> {
  let choices: UserChoices | null = null;

  // Loop until we get a valid choice (not 'back')
  while (!choices) {
    // First show quick actions menu
    const quickChoice = await askQuickAction();

    const updateType = await resolveUpdateType(quickChoice);

    if (updateType === 'back') {
      continue; // Continue the loop to show quick menu again
    }

    // Now we have a valid update type, create the choices object
    choices = await createUserChoices(updateType);
  }

  return choices;
}

/**
 * Resolves the update type from quick action selection.
 */
async function resolveUpdateType(
  quickChoice: 'quick-process' | 'quick-search' | 'quick-summarize' | 'advanced',
): Promise<UserChoices['updateType'] | 'back'> {
  if (quickChoice === 'advanced') {
    // Show advanced menu with grouped categories
    return await askAdvancedUpdateType();
  } else {
    // Map quick action to actual update type
    return mapQuickActionToUpdateType(quickChoice);
  }
}

/**
 * Creates the user choices object based on the update type.
 */
async function createUserChoices(updateType: UserChoices['updateType']): Promise<UserChoices> {
  const choiceBuilders: Record<string, () => Promise<UserChoices>> = {
    append: createAppendChoices,
    summarize: createSummarizeChoices,
    search: createSearchChoices,
    'import-sqlite': createSQLiteImportChoices,
    tokenize: createTokenizeChoices,
    'configure-tokenization': createConfigureTokenizationChoices,
    'run-sql': createRunSQLChoices,
    'rank-tokens': createRankTokensChoices,
    diff: () => createFileProcessingChoices('diff'),
    full: () => createFileProcessingChoices('full'),
  };

  const builder = choiceBuilders[updateType];
  if (builder) {
    return await builder();
  }

  throw new Error(`Unknown update type: ${updateType}`);
}

/**
 * Runs the main application loop.
 */
export async function runMainLoop(): Promise<void> {
  let continueRunning = true;

  while (continueRunning) {
    // Display banner
    const { displayBanner } = await import('./display');
    displayBanner();

    try {
      const choices = await getUserChoice();

      // Load configuration
      const { loadConfiguration, getDataFilePath } = await import('./config');
      const config = loadConfiguration();
      const dataFilePath = getDataFilePath(config);

      // Display configuration summary
      const { displayConfigurationSummary } = await import('./display');
      displayConfigurationSummary(choices, dataFilePath);

      // Process the user's choice
      const { processUserChoice } = await import('./operations');
      continueRunning = await processUserChoice(choices, dataFilePath);
    } catch (error) {
      console.error('❌ An error occurred during configuration:', (error as Error).message);
      continueRunning = false;
    }
  }
}
