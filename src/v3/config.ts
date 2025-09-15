/**
 * Configuration management functions for the ebook CLI tool.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Loads and parses the configuration from config.json.
 */
export function loadConfiguration(): { outputDir: string; dataFile?: string } {
  const configPath = path.join(process.cwd(), 'config.json');
  const configData = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(configData);
}

/**
 * Gets the full path to the data file based on configuration.
 */
export function getDataFilePath(config: { outputDir: string; dataFile?: string }): string {
  return path.join(process.cwd(), config.outputDir, config.dataFile ?? 'data.json');
}
