/**
 * Token ranking utilities for analyzing and ranking token occurrences in ebook data.
 * Provides functionality to count, sort, and display most frequently occurring tokens.
 */

import * as fs from 'fs';
import * as path from 'path';
import sqlite3 from 'sqlite3';

/**
 * Interface for token ranking results
 */
export interface TokenRanking {
  token: string;
  count: number;
  percentage: number;
}

/**
 * Interface for ebook entry with tokenized data
 */
interface EbookEntry {
  title?: string;
  filename?: string;
  tokens?: string[]; // Array of token strings, not object with title/filename
}

/**
 * Interface for SQLite row data
 */
interface SQLiteRow {
  tokens?: string;
}

/**
 * Counts token frequency from tokenized ebook data
 * @param data Array of ebook entries with tokenized data
 * @returns Map of token to count
 */
function countTokenFrequency(data: EbookEntry[]): Map<string, number> {
  const tokenCounts = new Map<string, number>();

  for (const entry of data) {
    if (entry.tokens && Array.isArray(entry.tokens)) {
      // Count all tokens from the array
      for (const token of entry.tokens) {
        if (typeof token === 'string') {
          tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
        }
      }
    }
  }

  return tokenCounts;
}

/**
 * Counts token frequency from SQLite database
 * @param dbPath Path to SQLite database
 * @returns Promise resolving to Map of token to count
 */
async function countTokenFrequencySQLite(dbPath: string): Promise<Map<string, number>> {
  return new Promise((resolve, reject) => {
    const tokenCounts = new Map<string, number>();

    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        reject(err);
        return;
      }

      // Query to get all tokenized data
      const query = `
        SELECT tokens
        FROM ebooks
        WHERE tokens IS NOT NULL
      `;

      db.all(query, [], (err, rows: SQLiteRow[]) => {
        if (err) {
          db.close();
          reject(err);
          return;
        }

        for (const row of rows) {
          // Process tokens from the JSON column
          if (row.tokens) {
            try {
              const tokenData = JSON.parse(row.tokens);

              // tokenData should be an array of strings
              if (Array.isArray(tokenData)) {
                for (const token of tokenData) {
                  if (typeof token === 'string') {
                    tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
                  }
                }
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }

        db.close();
        resolve(tokenCounts);
      });
    });
  });
}

/**
 * Ranks tokens by frequency and calculates percentages
 * @param tokenCounts Map of token to count
 * @param topN Optional limit for number of results
 * @returns Array of ranked token results
 */
function rankTokens(tokenCounts: Map<string, number>, topN?: number): TokenRanking[] {
  const totalTokens = Array.from(tokenCounts.values()).reduce((sum, count) => sum + count, 0);

  const rankings: TokenRanking[] = Array.from(tokenCounts.entries())
    .map(([token, count]) => ({
      token,
      count,
      percentage: (count / totalTokens) * 100,
    }))
    .sort((a, b) => b.count - a.count); // Sort by count descending

  return topN ? rankings.slice(0, topN) : rankings;
}

/**
 * Displays token ranking results in a formatted way
 * @param rankings Array of token rankings
 * @param source Source of the data (JSON or SQLite)
 * @param maxDisplay Optional limit for display (defaults to 50, use undefined for all)
 */
function displayTokenRankings(rankings: TokenRanking[], source: string, maxDisplay: number = 50): void {
  console.log('\n📊 Token Occurrence Ranking');
  console.log('===========================');
  console.log(`Source: ${source}`);
  console.log(`Total unique tokens: ${rankings.length}`);
  console.log(`Total token occurrences: ${rankings.reduce((sum, r) => sum + r.count, 0)}`);
  console.log('');

  if (rankings.length === 0) {
    console.log('❌ No tokenized data found!');
    console.log('💡 Run tokenization first to generate token data for ranking.');
    return;
  }

  console.log('🏆 Top Tokens by Occurrences:');
  console.log('─────────────────────────────');

  // Display all rankings if maxDisplay is undefined, otherwise limit to maxDisplay
  const displayCount = maxDisplay === undefined ? rankings.length : Math.min(maxDisplay, rankings.length);
  rankings.slice(0, displayCount).forEach((ranking, index) => {
    const rank = (index + 1).toString().padStart(3, ' ');
    const token = ranking.token.padEnd(20, ' ');
    const count = ranking.count.toString().padStart(6, ' ');
    const percentage = ranking.percentage.toFixed(2).padStart(6, ' ');

    console.log(`${rank}. ${token} | ${count} uses | ${percentage}%`);
  });

  if (rankings.length > displayCount) {
    console.log(`\n... and ${rankings.length - displayCount} more tokens`);
  }

  // Show some statistics
  const top10Percentage = rankings.slice(0, 10).reduce((sum, r) => sum + r.percentage, 0);
  const top50Percentage = rankings.slice(0, 50).reduce((sum, r) => sum + r.percentage, 0);

  console.log('\n📈 Occurrence Statistics:');
  console.log(`   Top 10 tokens: ${top10Percentage.toFixed(1)}% of all token occurrences`);
  console.log(`   Top 50 tokens: ${top50Percentage.toFixed(1)}% of all token occurrences`);
}

/**
 * Analyzes and ranks token occurrences from JSON data file
 * @param dataFilePath Path to data.json file
 * @param topN Optional limit for number of results to display
 */
export async function rankTokensFromJSON(dataFilePath: string, topN?: number): Promise<void> {
  try {
    console.log('📖 Reading data from JSON file...');

    if (!fs.existsSync(dataFilePath)) {
      console.log('❌ Data file not found!');
      console.log(`   Expected location: ${dataFilePath}`);
      return;
    }

    const data: EbookEntry[] = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
    const tokenCounts = countTokenFrequency(data);
    const rankings = rankTokens(tokenCounts, topN);

    displayTokenRankings(rankings, 'JSON File (data.json)', topN);
  } catch (error) {
    console.error('❌ Error ranking tokens from JSON:', (error as Error).message);
  }
}

/**
 * Analyzes and ranks token occurrences from SQLite database
 * @param dbPath Path to SQLite database
 * @param topN Optional limit for number of results to display
 */
export async function rankTokensFromSQLite(dbPath: string, topN?: number): Promise<void> {
  try {
    console.log('🗄️  Reading data from SQLite database...');

    if (!fs.existsSync(dbPath)) {
      console.log('❌ SQLite database not found!');
      console.log(`   Expected location: ${dbPath}`);
      return;
    }

    const tokenCounts = await countTokenFrequencySQLite(dbPath);
    const rankings = rankTokens(tokenCounts, topN);

    displayTokenRankings(rankings, 'SQLite Database', topN);
  } catch (error) {
    console.error('❌ Error ranking tokens from SQLite:', (error as Error).message);
  }
}

/**
 * Interactive function to rank tokens with user choice of data source
 * @param dataFilePath Path to data.json file
 */
export async function rankTokensInteractive(dataFilePath: string): Promise<void> {
  const inquirer = await import('inquirer');

  const sourceChoices = [
    {
      name: 'Rank from data.json (JSON file)',
      value: 'json' as const,
    },
    {
      name: 'Rank from SQLite database',
      value: 'sqlite' as const,
    },
  ];

  const sourceAnswer = await inquirer.default.prompt({
    type: 'list',
    name: 'source',
    message: 'Choose data source for token ranking:',
    choices: sourceChoices,
  });

  const topNAnswer = await inquirer.default.prompt({
    type: 'number',
    name: 'topN',
    message: 'How many top tokens to display?',
    default: 100,
    validate: (value: number | undefined) => {
      if (value === undefined || value > 0) return true;
      return 'Please enter a positive number';
    },
  });

  if (sourceAnswer.source === 'sqlite') {
    const dbPath = path.join(path.dirname(dataFilePath), 'ebooks.db');
    await rankTokensFromSQLite(dbPath, topNAnswer.topN);
  } else {
    await rankTokensFromJSON(dataFilePath, topNAnswer.topN);
  }
}
