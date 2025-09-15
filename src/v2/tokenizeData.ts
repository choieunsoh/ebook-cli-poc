/**
 * Module for tokenizing ebook titles and filenames to enhance search capabilities.
 */

import * as fs from 'fs';
import natural from 'natural';
import * as path from 'path';

interface EbookRecord {
  id: number;
  file: string;
  title?: string;
  tokens?: string;
}

interface TokenizationConfig {
  enabled: boolean;
  minTokenLength: number;
  maxTokenLength: number;
  removeStopwords: boolean;
  useStemming: boolean;
  customStopwords: string[];
  fieldsToTokenize: string[];
}

/**
 * Tokenizes a given text string into an array of tokens.
 * Normalizes text, removes stopwords, and applies stemming.
 * @param text The text to tokenize
 * @param config Tokenization configuration
 * @returns Array of tokenized words
 */
function tokenizeText(text: string, config: TokenizationConfig): string[] {
  if (!text || !config.enabled) return [];

  // Normalize: lowercase, remove special characters, keep alphanumeric and spaces
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');

  // Tokenize
  const tokenizer = new natural.WordTokenizer();
  const tokens = tokenizer.tokenize(normalized) || [];

  // Filter by length
  let filteredTokens = tokens.filter(
    (token) => token.length >= config.minTokenLength && token.length <= config.maxTokenLength,
  );

  // Remove stopwords
  if (config.removeStopwords) {
    const defaultStopwords = natural.stopwords;
    const allStopwords = [...defaultStopwords, ...config.customStopwords];
    filteredTokens = filteredTokens.filter((token) => !allStopwords.includes(token));
  }

  // Apply stemming
  let finalTokens = filteredTokens;
  if (config.useStemming) {
    const stemmer = natural.PorterStemmer;
    finalTokens = filteredTokens.map((token) => stemmer.stem(token));
  }

  // Remove duplicates and empty strings
  return [...new Set(finalTokens)].filter((token) => token.length > 0);
}

/**
 * Processes the data.json file to add tokenized data for titles and filenames.
 * @param dataFilePath Path to the data.json file
 * @param forceUpdate If true, re-tokenize even if tokens already exist
 */
export async function tokenizeData(dataFilePath: string, forceUpdate: boolean = false): Promise<void> {
  try {
    console.log(`🔍 Reading data from: ${dataFilePath}`);

    // Load configuration
    const configPath = path.join(process.cwd(), 'config.json');
    const configData = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configData);
    const tokenizationConfig: TokenizationConfig = config.tokenization || {
      enabled: true,
      minTokenLength: 2,
      maxTokenLength: 50,
      removeStopwords: true,
      useStemming: true,
      customStopwords: [],
      fieldsToTokenize: ['title', 'filename'],
    };

    if (!tokenizationConfig.enabled) {
      console.log('ℹ️  Tokenization is disabled in config.json');
      return;
    }

    // Read the data file
    const data = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));

    if (!Array.isArray(data)) {
      throw new Error('Data file is not an array of ebook entries.');
    }

    console.log(`📊 Processing ${data.length} ebook entries...`);

    let processedCount = 0;
    let skippedCount = 0;

    // Process each ebook entry
    for (const entry of data) {
      // Skip if tokens already exist and not forcing update
      if (entry.tokens && !forceUpdate) {
        skippedCount++;
        continue;
      }

      const tokens: string[] = [];

      // Tokenize filename
      if (entry.file) {
        const filenameTokens = tokenizeText(entry.file, tokenizationConfig);
        tokens.push(...filenameTokens);
      }

      // Tokenize title from metadata
      if (entry.metadata && entry.metadata.title) {
        const titleTokens = tokenizeText(entry.metadata.title, tokenizationConfig);
        tokens.push(...titleTokens);
      }

      // Remove duplicates across filename and title
      entry.tokens = [...new Set(tokens)];

      processedCount++;
      if ((processedCount + skippedCount) % 100 === 0) {
        console.log(`✅ Processed ${processedCount} entries, skipped ${skippedCount}...`);
      }
    }

    // Write back to file
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
    console.log(
      `✅ Tokenization complete! Updated ${processedCount} entries, skipped ${skippedCount} with existing tokens.`,
    );

    // Also update SQLite if it exists
    await tokenizeSQLiteData(dataFilePath, forceUpdate, tokenizationConfig);
  } catch (error) {
    console.error('❌ Error during tokenization:', (error as Error).message);
    throw error;
  }
}

/**
 * Processes the SQLite database to add tokenized data for titles and filenames.
 * @param dataFilePath Path to the data.json file (to locate SQLite db)
 * @param forceUpdate If true, re-tokenize even if tokens already exist
 * @param config Tokenization configuration
 */
async function tokenizeSQLiteData(
  dataFilePath: string,
  forceUpdate: boolean = false,
  config: TokenizationConfig,
): Promise<void> {
  try {
    const dbPath = path.join(path.dirname(dataFilePath), 'ebooks.db');
    if (!fs.existsSync(dbPath)) {
      console.log('ℹ️  SQLite database not found, skipping SQLite tokenization.');
      return;
    }

    // Dynamic import of sqlite3
    const sqlite3 = await import('sqlite3');
    const { Database } = sqlite3.default || sqlite3;

    const db = new Database(dbPath);

    console.log('🔍 Updating SQLite database with tokens...');

    // Add tokens column if it doesn't exist
    await new Promise<void>((resolve, reject) => {
      db.run('ALTER TABLE ebooks ADD COLUMN tokens TEXT', (err: Error | null) => {
        if (err && !err.message.includes('duplicate column name')) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    // Get all records
    const records = await new Promise<EbookRecord[]>((resolve, reject) => {
      db.all('SELECT id, file, title FROM ebooks', (err: Error | null, rows: EbookRecord[]) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    let updatedCount = 0;
    let skippedCount = 0;

    for (const record of records) {
      // Check if tokens exist and not forcing update
      if (!forceUpdate) {
        const existingTokens = await new Promise<{ tokens?: string } | undefined>((resolve, reject) => {
          db.get(
            'SELECT tokens FROM ebooks WHERE id = ?',
            [record.id],
            (err: Error | null, row: { tokens?: string } | undefined) => {
              if (err) reject(err);
              else resolve(row);
            },
          );
        });
        if (existingTokens && existingTokens.tokens) {
          skippedCount++;
          continue;
        }
      }

      const tokens: string[] = [];

      // Tokenize filename
      if (record.file) {
        const filenameTokens = tokenizeText(record.file, config);
        tokens.push(...filenameTokens);
      }

      // Tokenize title
      if (record.title) {
        const titleTokens = tokenizeText(record.title, config);
        tokens.push(...titleTokens);
      }

      // Update record with tokens
      await new Promise<void>((resolve, reject) => {
        db.run(
          'UPDATE ebooks SET tokens = ? WHERE id = ?',
          [JSON.stringify([...new Set(tokens)]), record.id],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          },
        );
      });

      updatedCount++;
    }

    db.close();

    console.log(`✅ SQLite tokenization complete! Updated ${updatedCount} records, skipped ${skippedCount}.`);
  } catch (error) {
    console.error('❌ Error during SQLite tokenization:', (error as Error).message);
    // Don't throw, as JSON tokenization might have succeeded
  }
}
