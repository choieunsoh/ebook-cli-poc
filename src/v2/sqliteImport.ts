/**
 * Module for importing data.json to SQLite database
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProcessingResult } from './types';

interface EbookRecord {
  id?: number;
  updated_at?: string;
}

/**
 * Safely converts a date value to ISO string
 * @param dateValue - The date value to convert
 * @returns ISO string or null if invalid
 */
function safeDateToISOString(dateValue: unknown): string | null {
  if (!dateValue) return null;

  try {
    // If it's already a string, validate it's a valid date string
    if (typeof dateValue === 'string') {
      const parsed = new Date(dateValue);
      if (isNaN(parsed.getTime())) return null;
      return parsed.toISOString();
    }

    // If it's a Date object, convert it
    if (dateValue instanceof Date) {
      if (isNaN(dateValue.getTime())) return null;
      return dateValue.toISOString();
    }

    // If it's a number (timestamp), convert it
    if (typeof dateValue === 'number') {
      const date = new Date(dateValue);
      if (isNaN(date.getTime())) return null;
      return date.toISOString();
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Imports data from data.json to SQLite database with deduplication
 * @param dataFilePath - Path to the data.json file
 */
export async function importToSQLite(dataFilePath: string): Promise<void> {
  try {
    // Dynamic import of sqlite3 to avoid issues if not installed
    const sqlite3 = await import('sqlite3');
    const { Database } = sqlite3.default || sqlite3;

    if (!fs.existsSync(dataFilePath)) {
      console.log('❌ data.json not found.');
      return;
    }

    const data: ProcessingResult[] = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));

    if (data.length === 0) {
      console.log('⚠️  No data found in data.json');
      return;
    }

    // Create SQLite database file in the same directory as data.json
    const dbDir = path.dirname(dataFilePath);
    const dbPath = path.join(dbDir, 'ebooks.db');

    console.log(`📊 Importing ${data.length} records to SQLite database...`);
    console.log(`📁 Database location: ${dbPath}`);

    const db = new Database(dbPath);

    // Create tables
    await new Promise<void>((resolve, reject) => {
      db.run(
        `
        CREATE TABLE IF NOT EXISTS ebooks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          file TEXT UNIQUE NOT NULL,
          type TEXT NOT NULL,
          title TEXT,
          author TEXT,
          creator TEXT,
          subject TEXT,
          description TEXT,
          language TEXT,
          date TEXT,
          pages INTEGER,
          size INTEGER,
          created_date TEXT,
          modified_date TEXT,
          accessed_date TEXT,
          file_path TEXT,
          metadata_json TEXT,
          tokens TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });

    // Create indexes for better query performance
    await new Promise<void>((resolve, reject) => {
      db.run(
        `
        CREATE INDEX IF NOT EXISTS idx_file ON ebooks(file);
        CREATE INDEX IF NOT EXISTS idx_title ON ebooks(title);
        CREATE INDEX IF NOT EXISTS idx_author ON ebooks(author);
        CREATE INDEX IF NOT EXISTS idx_type ON ebooks(type);
      `,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });

    // Insert data with deduplication
    let inserted = 0;
    let skipped = 0;
    let updated = 0;

    for (const item of data) {
      try {
        const metadata = item.metadata || {};
        const fileMetadata = item.fileMetadata;

        // Check if record already exists
        const existing = await new Promise<EbookRecord | undefined>((resolve, reject) => {
          db.get(
            'SELECT id, updated_at FROM ebooks WHERE file = ?',
            [item.file],
            (err: Error | null, row: EbookRecord | undefined) => {
              if (err) reject(err);
              else resolve(row);
            },
          );
        });

        if (existing) {
          // Update existing record
          await new Promise<void>((resolve, reject) => {
            db.run(
              `
              UPDATE ebooks SET
                title = ?, author = ?, creator = ?, subject = ?, description = ?,
                language = ?, date = ?, pages = ?, size = ?,
                created_date = ?, modified_date = ?, accessed_date = ?,
                file_path = ?, metadata_json = ?, tokens = ?, updated_at = CURRENT_TIMESTAMP
              WHERE file = ?
            `,
              [
                metadata.title || null,
                (metadata as Record<string, unknown>).author || (metadata as Record<string, unknown>).creator || null,
                (metadata as Record<string, unknown>).creator || null,
                (metadata as Record<string, unknown>).subject || null,
                (metadata as Record<string, unknown>).description || null,
                (metadata as Record<string, unknown>).language || null,
                (metadata as Record<string, unknown>).date || null,
                (metadata as Record<string, unknown>).pages || null,
                fileMetadata.size || null,
                safeDateToISOString(fileMetadata.created),
                safeDateToISOString(fileMetadata.modified),
                safeDateToISOString(fileMetadata.accessed),
                fileMetadata.path || null,
                JSON.stringify(metadata),
                item.tokens ? JSON.stringify(item.tokens) : null,
                item.file,
              ],
              function (err: Error | null) {
                if (err) reject(err);
                else resolve();
              },
            );
          });
          updated++;
        } else {
          // Insert new record
          await new Promise<void>((resolve, reject) => {
            db.run(
              `
              INSERT INTO ebooks (
                file, type, title, author, creator, subject, description,
                language, date, pages, size, created_date, modified_date,
                accessed_date, file_path, metadata_json, tokens
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
              [
                item.file,
                item.type,
                metadata.title || null,
                (metadata as Record<string, unknown>).author || (metadata as Record<string, unknown>).creator || null,
                (metadata as Record<string, unknown>).creator || null,
                (metadata as Record<string, unknown>).subject || null,
                (metadata as Record<string, unknown>).description || null,
                (metadata as Record<string, unknown>).language || null,
                (metadata as Record<string, unknown>).date || null,
                (metadata as Record<string, unknown>).pages || null,
                fileMetadata.size || null,
                safeDateToISOString(fileMetadata.created),
                safeDateToISOString(fileMetadata.modified),
                safeDateToISOString(fileMetadata.accessed),
                fileMetadata.path || null,
                JSON.stringify(metadata),
                item.tokens ? JSON.stringify(item.tokens) : null,
              ],
              function (err: Error | null) {
                if (err) reject(err);
                else resolve();
              },
            );
          });
          inserted++;
        }
      } catch (error) {
        console.log(`⚠️  Error processing ${item.file}: ${(error as Error).message}`);
        skipped++;
      }
    }

    // Close database
    db.close();

    console.log('\n✅ SQLite Import Complete!');
    console.log('===========================');
    console.log(`📊 Total records processed: ${data.length}`);
    console.log(`✅ Records inserted: ${inserted}`);
    console.log(`🔄 Records updated: ${updated}`);
    console.log(`⏭️  Records skipped: ${skipped}`);
    console.log(`📁 Database file: ${dbPath}`);

    console.log('\n🔍 You can now query the database using SQL:');
    console.log(`   SELECT * FROM ebooks WHERE title LIKE '%search_term%';`);
    console.log(`   SELECT COUNT(*) as total_books FROM ebooks;`);
    console.log(`   SELECT type, COUNT(*) as count FROM ebooks GROUP BY type;`);
    console.log(`   SELECT title, author FROM ebooks WHERE author LIKE '%Author Name%';`);
    console.log(`   SELECT * FROM ebooks ORDER BY created_at DESC LIMIT 10;`);
    console.log(`   SELECT file, size FROM ebooks ORDER BY size DESC LIMIT 5;`);
    console.log(`   SELECT DISTINCT language FROM ebooks WHERE language IS NOT NULL;`);
    console.log(`   SELECT COUNT(*) as pdf_count FROM ebooks WHERE type = 'pdf';`);
    console.log(`   SELECT COUNT(*) as epub_count FROM ebooks WHERE type = 'epub';`);
  } catch (error) {
    if ((error as Error).message.includes('Cannot find module')) {
      console.log('❌ SQLite3 module not found. Please install it:');
      console.log('   npm install sqlite3');
      console.log('   or');
      console.log('   yarn add sqlite3');
    } else {
      console.log(`❌ Error importing to SQLite: ${(error as Error).message}`);
    }
  }
}
