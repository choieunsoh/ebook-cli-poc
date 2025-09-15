/**
 * Module for searching data in data.json and SQLite database
 */

import { exec } from 'child_process';
import * as fs from 'fs';
import inquirer from 'inquirer';
import natural from 'natural';
import { promisify } from 'util';
import { ProcessingResult } from './types';

const execAsync = promisify(exec);

interface SQLiteEbookRow {
  id: number;
  file: string;
  type: string;
  title: string | null;
  author: string | null;
  file_path: string;
  created_at: string;
}

/**
 * Parses search terms and operators from user input
 * @param searchInput - Raw search input from user
 * @returns Object with parsed terms, stemmed terms, and operator
 */
function parseSearchQuery(searchInput: string): {
  terms: string[];
  stemmedTerms: string[];
  operator: 'AND' | 'OR' | 'PHRASE';
} {
  const input = searchInput.trim().toLowerCase();

  // Check for explicit operators
  if (input.includes(' and ')) {
    const terms = input
      .split(/\s+and\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 0);
    const stemmedTerms = terms.map((term) => natural.PorterStemmer.stem(term));
    return { terms, stemmedTerms, operator: 'AND' };
  }

  // Check for + syntax (concise AND)
  if (input.includes('+')) {
    const terms = input
      .split(/\+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 0);
    const stemmedTerms = terms.map((term) => natural.PorterStemmer.stem(term));
    return { terms, stemmedTerms, operator: 'AND' };
  }

  if (input.includes(' or ')) {
    const terms = input
      .split(/\s+or\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 0);
    const stemmedTerms = terms.map((term) => natural.PorterStemmer.stem(term));
    return { terms, stemmedTerms, operator: 'OR' };
  }

  // Check for quoted phrases
  const quotedMatch = input.match(/"([^"]+)"/);
  if (quotedMatch) {
    const terms = [quotedMatch[1]];
    const stemmedTerms = terms.map((term) => natural.PorterStemmer.stem(term));
    return { terms, stemmedTerms, operator: 'PHRASE' };
  }

  // Default: treat as OR search with space-separated terms
  const terms = input.split(/\s+/).filter((term) => term.length > 0);
  const stemmedTerms = terms.map((term) => natural.PorterStemmer.stem(term));
  return { terms: terms.length > 1 ? terms : [input], stemmedTerms, operator: terms.length > 1 ? 'OR' : 'PHRASE' };
}

/**
 * Builds SQL WHERE clause for advanced search including tokens
 * @param terms - Search terms
 * @param stemmedTerms - Stemmed search terms
 * @param operator - Search operator
 * @returns SQL WHERE clause
 */
function buildSearchWhereClause(terms: string[], stemmedTerms: string[], operator: 'AND' | 'OR' | 'PHRASE'): string {
  if (terms.length === 0) return '1=1'; // Always true if no terms

  const conditions = terms.map((term, index) => {
    const searchTerm = term.replace(/'/g, "''"); // Escape single quotes for SQL
    const stemmedTerm = stemmedTerms[index].replace(/'/g, "''");
    return `(LOWER(title) LIKE LOWER('%${searchTerm}%') OR LOWER(file) LIKE LOWER('%${searchTerm}%') OR (tokens IS NOT NULL AND tokens LIKE '%"${stemmedTerm}"%'))`;
  });

  if (operator === 'PHRASE' || terms.length === 1) {
    return conditions[0];
  }

  const joinOperator = operator === 'AND' ? ' AND ' : ' OR ';
  return `(${conditions.join(joinOperator)})`;
}

/**
 * Opens a file using the system's default application
 * @param filePath - Path to the file to open
 */
async function openFile(filePath: string): Promise<void> {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.log(`❌ File not found: ${filePath}`);
      return;
    }

    let command: string;
    const { platform } = process;

    // Use appropriate command based on platform
    if (platform === 'win32') {
      command = `start "" "${filePath}"`;
    } else if (platform === 'darwin') {
      command = `open "${filePath}"`;
    } else {
      // Linux and other Unix-like systems
      command = `xdg-open "${filePath}"`;
    }

    await execAsync(command);
    console.log(`📖 Opened: ${filePath}`);
  } catch (error) {
    console.error(`❌ Failed to open file: ${(error as Error).message}`);
  }
}

/**
 * Searches for ebooks by title or filename in SQLite database.
 * Continues prompting for new search terms until term is empty.
 * @param dbPath - Path to the SQLite database file
 */
export async function searchByTitleSQLite(dbPath: string): Promise<void> {
  let continueSearching = true;
  let currentSearchTerm = '';

  // Dynamic import for sqlite3 to handle optional dependency
  const sqlite3 = await import('sqlite3');
  const { Database } = sqlite3.default || sqlite3;

  while (continueSearching) {
    // Prompt for search term if not provided
    if (!currentSearchTerm.trim()) {
      const searchAnswer = await inquirer.prompt([
        {
          type: 'input',
          name: 'searchTerm',
          message:
            'Enter a search term (supports: "term1+term2", "term1 and term2", "term1 or term2", "quoted phrase", "back" to return to main menu, empty to quit):',
          validate: () => {
            return true; // Allow empty input to quit
          },
        },
      ]);
      currentSearchTerm = searchAnswer.searchTerm.trim();

      // Check for back navigation
      if (currentSearchTerm.toLowerCase() === 'back') {
        console.log('⬅️  Returning to main menu...');
        return;
      }

      // Exit if term is empty
      if (!currentSearchTerm) {
        console.log('👋 Search session ended. Returning to main menu...');
        return;
      }
    }

    try {
      const db = new Database(dbPath);

      // Parse search query for advanced search
      const { terms, stemmedTerms, operator } = parseSearchQuery(currentSearchTerm);
      const whereClause = buildSearchWhereClause(terms, stemmedTerms, operator);

      // Search query with advanced search capabilities
      const query = `
        SELECT id, file, type, title, author, file_path, created_at
        FROM ebooks
        WHERE ${whereClause}
        ORDER BY title
      `;

      // Convert callback-based db.all to Promise
      const rows = await new Promise<SQLiteEbookRow[]>((resolve, reject) => {
        db.all(query, [], (err: Error | null, rows: SQLiteEbookRow[]) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        });
      });

      console.log('\n🔍 SQLite Search Results');
      console.log('========================');
      console.log(`Search Term: "${currentSearchTerm}"`);
      console.log(`Parsed as: ${terms.join(` ${operator.toLowerCase()} `)} (${operator})`);
      console.log(`Total matches: ${rows.length}`);

      if (rows.length > 0) {
        console.log('\n📋 Matching Files:');
        console.log('==================');
        rows.forEach((row, index) => {
          console.log(`${index + 1}. ${row.file} (${row.type})`);
          console.log(`   Title: ${row.title || 'No title'}`);
          console.log(`   Author: ${row.author || 'Unknown author'}`);
          console.log(`   Path: ${row.file_path}`);
          console.log(`   Database ID: ${row.id}`);
          console.log('');
        });

        // Ask user if they want to open a file
        const openAnswer = await inquirer.prompt([
          {
            type: 'input',
            name: 'fileNumber',
            message: 'Enter the number of the ebook to open (or press Enter to continue searching):',
            validate: (input: string) => {
              if (!input.trim()) return true; // Allow empty input
              const num = parseInt(input);
              if (isNaN(num) || num < 1 || num > rows.length) {
                return `Please enter a number between 1 and ${rows.length}, or press Enter to skip.`;
              }
              return true;
            },
          },
        ]);

        if (openAnswer.fileNumber.trim()) {
          const selectedIndex = parseInt(openAnswer.fileNumber) - 1;
          const selectedFile = rows[selectedIndex];
          await openFile(selectedFile.file_path);
        }
      } else {
        console.log('No matches found.');
      }

      db.close();
    } catch (error) {
      console.error('❌ Database query error:', (error as Error).message);
      continueSearching = false;
      break;
    }

    // Prompt for new search term
    const searchAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'searchTerm',
        message:
          'Enter a new search term (supports: "term1+term2", "term1 and term2", "term1 or term2", "quoted phrase", "back" to return to main menu, empty to quit):',
        validate: () => {
          return true; // Allow empty input to quit
        },
      },
    ]);
    currentSearchTerm = searchAnswer.searchTerm.trim();

    // Check for back navigation
    if (currentSearchTerm.toLowerCase() === 'back') {
      console.log('⬅️  Returning to main menu...');
      return;
    }

    // Exit if term is empty
    if (!currentSearchTerm) {
      continueSearching = false;
      console.log('👋 Search session ended. Returning to main menu...');
    }
  }
}

/**
 * Searches for ebooks by title or filename containing the search term.
 * Continues prompting for new search terms until term is empty.
 * @param dataFilePath - Path to the data.json file
 * @param initialSearchTerm - The initial term to search for
 */
export async function searchByTitle(dataFilePath: string, initialSearchTerm: string): Promise<void> {
  let continueSearching = true;
  let currentSearchTerm = initialSearchTerm;

  // If no initial search term, prompt for the first one
  if (!currentSearchTerm.trim()) {
    const searchAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'searchTerm',
        message:
          'Enter a search term (supports: "term1+term2", "term1 and term2", "term1 or term2", "quoted phrase", "back" to return to main menu, empty to quit):',
        validate: () => {
          return true; // Allow empty input to quit
        },
      },
    ]);
    currentSearchTerm = searchAnswer.searchTerm.trim();

    // Check for back navigation
    if (currentSearchTerm.toLowerCase() === 'back') {
      console.log('⬅️  Returning to main menu...');
      return;
    }

    // Exit if term is empty
    if (!currentSearchTerm) {
      console.log('👋 Search session ended. Returning to main menu...');
      return;
    }
  }

  while (continueSearching) {
    if (fs.existsSync(dataFilePath)) {
      const data = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8')) as ProcessingResult[];

      // Parse search query for advanced search
      const { terms, stemmedTerms, operator } = parseSearchQuery(currentSearchTerm);
      const lowerTerms = terms.map((term) => term.toLowerCase());

      const matches = data.filter((d) => {
        const title = (d.metadata as { title?: string })?.title?.toLowerCase() || '';
        const file = d.file.toLowerCase();
        const tokens = d.tokens || [];

        // Check original search
        let matchesOriginal = false;
        if (operator === 'AND') {
          matchesOriginal = lowerTerms.every((term) => title.includes(term) || file.includes(term));
        } else if (operator === 'OR') {
          matchesOriginal = lowerTerms.some((term) => title.includes(term) || file.includes(term));
        } else {
          matchesOriginal = lowerTerms.some((term) => title.includes(term) || file.includes(term));
        }

        // Check tokens
        let matchesTokens = false;
        if (tokens.length > 0) {
          if (operator === 'AND') {
            matchesTokens = stemmedTerms.every((term) => tokens.includes(term));
          } else if (operator === 'OR') {
            matchesTokens = stemmedTerms.some((term) => tokens.includes(term));
          } else {
            matchesTokens = stemmedTerms.some((term) => tokens.includes(term));
          }
        }

        return matchesOriginal || matchesTokens;
      });

      console.log('\n🔍 Search Results');
      console.log('=================');
      console.log(`Search Term: "${currentSearchTerm}"`);
      console.log(`Parsed as: ${terms.join(` ${operator.toLowerCase()} `)} (${operator})`);
      console.log(`Total matches: ${matches.length}`);

      if (matches.length > 0) {
        console.log('\n📋 Matching Files:');
        console.log('==================');
        matches.forEach((d, index) => {
          const title = (d.metadata as { title?: string })?.title || 'No title';
          const author = (d.metadata as { author?: string })?.author || 'Unknown author';
          console.log(`${index + 1}. ${d.file} (${d.type})`);
          console.log(`   Title: ${title}`);
          console.log(`   Author: ${author}`);
          console.log(`   Path: ${d.fileMetadata.path}`);
          console.log('');
        });

        // Ask user if they want to open a file
        const openAnswer = await inquirer.prompt([
          {
            type: 'input',
            name: 'fileNumber',
            message: 'Enter the number of the ebook to open (or press Enter to continue searching):',
            validate: (input: string) => {
              if (!input.trim()) return true; // Allow empty input
              const num = parseInt(input);
              if (isNaN(num) || num < 1 || num > matches.length) {
                return `Please enter a number between 1 and ${matches.length}, or press Enter to skip.`;
              }
              return true;
            },
          },
        ]);

        if (openAnswer.fileNumber.trim()) {
          const selectedIndex = parseInt(openAnswer.fileNumber) - 1;
          const selectedFile = matches[selectedIndex];
          await openFile(selectedFile.fileMetadata.path);
        }
      } else {
        console.log('No matches found.');
      }
    } else {
      console.log('❌ data.json not found.');
      break;
    }

    // Prompt for new search term
    const searchAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'searchTerm',
        message:
          'Enter a new search term (supports: "term1+term2", "term1 and term2", "term1 or term2", "quoted phrase", "back" to return to main menu, empty to quit):',
        validate: () => {
          return true; // Allow empty input to quit
        },
      },
    ]);
    currentSearchTerm = searchAnswer.searchTerm.trim();

    // Check for back navigation
    if (currentSearchTerm.toLowerCase() === 'back') {
      console.log('⬅️  Returning to main menu...');
      return;
    }

    // Exit if term is empty
    if (!currentSearchTerm) {
      continueSearching = false;
      console.log('👋 Search session ended. Returning to main menu...');
    }
  }
}
