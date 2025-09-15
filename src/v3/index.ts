/**
 * Interactive CLI tool for configuring ebook metadata extraction options.
 * Guides users through selecting update type, file types, and metadata extraction preferences.
 *
 * This is the main entry point that orchestrates the application flow.
 */

import { runMainLoop } from './workflow';

/**
 * Main application entry point.
 * Orchestrates the application flow.
 */
async function main(): Promise<void> {
  await runMainLoop();
}

// Start the application
main();
