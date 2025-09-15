/**
 * SQL Query Executor for SQLite database operations.
 * Provides interactive SQL query execution with support for dot commands.
 */

import * as fs from 'fs';
import inquirer from 'inquirer';
import * as path from 'path';

/**
 * Handles SQLite dot commands (special commands that start with '.')
 * @param db SQLite database instance
 * @param command The dot command to execute
 */
async function handleDotCommand(
  db: { all: (query: string, callback: (err: Error | null, rows: Record<string, unknown>[]) => void) => void },
  command: string,
): Promise<void> {
  const cmd = command.toLowerCase().trim();

  if (cmd === '.tables') {
    // Show all tables
    const results = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      db.all(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        (err: Error | null, rows: Record<string, unknown>[]) => {
          if (err) reject(err);
          else resolve(rows);
        },
      );
    });

    console.log('📋 Tables in database:');
    if (results.length > 0) {
      results.forEach((row) => {
        console.log(`  ${row.name}`);
      });
    } else {
      console.log('  No tables found.');
    }
  } else if (cmd.startsWith('.schema')) {
    // Show schema for a specific table or all tables
    const parts = command.split(/\s+/);
    let query: string;

    if (parts.length > 1) {
      // Schema for specific table
      const tableName = parts[1];
      query = `SELECT sql FROM sqlite_master WHERE type='table' AND name='${tableName}'`;
    } else {
      // Schema for all tables
      query = "SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name";
    }

    const results = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      db.all(query, (err: Error | null, rows: Record<string, unknown>[]) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    if (results.length > 0) {
      results.forEach((row) => {
        if (parts.length > 1) {
          console.log(`${row.sql}`);
        } else {
          console.log(`\n📋 Schema for table: ${row.name}`);
          console.log(`${row.sql}`);
        }
      });
    } else {
      console.log('❌ Table not found or no schema available.');
    }
  } else if (cmd === '.indexes') {
    // Show all indexes
    const results = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      db.all(
        "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' ORDER BY name",
        (err: Error | null, rows: Record<string, unknown>[]) => {
          if (err) reject(err);
          else resolve(rows);
        },
      );
    });

    console.log('📋 Indexes in database:');
    if (results.length > 0) {
      results.forEach((row) => {
        console.log(`  ${row.name} on ${row.tbl_name}`);
        if (row.sql) {
          console.log(`    ${row.sql}`);
        }
      });
    } else {
      console.log('  No indexes found.');
    }
  } else if (cmd === '.help') {
    // Show available commands
    console.log('📖 Available SQLite dot commands:');
    console.log('  .tables     - Show all tables');
    console.log('  .schema     - Show schema for all tables');
    console.log('  .schema <table> - Show schema for specific table');
    console.log('  .indexes    - Show all indexes');
    console.log('  .help       - Show this help message');
    console.log('  back        - Return to main menu');
    console.log('  exit/quit   - Exit the SQL session');
  } else {
    console.log(`❌ Unknown dot command: ${command}`);
    console.log('💡 Type ".help" to see available commands.');
  }
}

/**
 * Prompts user to enter and execute SQL queries on the SQLite database.
 * @returns Promise that resolves when SQL execution is complete
 */
export async function runSQLQuery(): Promise<void> {
  console.log('\n🗄️  SQL Query Executor');
  console.log('=====================');

  // Load config to get data file path
  const configPath = path.join(process.cwd(), 'config.json');
  const configData = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configData);
  const dataFilePath = path.join(process.cwd(), config.outputDir, config.dataFile ?? 'data.json');
  const dbPath = path.join(path.dirname(dataFilePath), 'ebooks.db');

  // Check if SQLite database exists
  if (!fs.existsSync(dbPath)) {
    console.log('❌ SQLite database not found!');
    console.log(`   Expected location: ${dbPath}`);
    console.log('   Please run "Import to SQLite Database" first to create the database.');
    return;
  }

  console.log(`📍 Database: ${dbPath}`);
  console.log('💡 Tips:');
  console.log('   - Use SELECT * FROM ebooks LIMIT 10; to see sample data');
  console.log('   - Use .tables to see available tables');
  console.log('   - Use .schema ebooks to see table structure');
  console.log('   - Use .indexes to see database indexes');
  console.log('   - Use .help to see all available commands');
  console.log('   - Type "back" to return to main menu');
  console.log('   - Type "exit" or "quit" to finish');
  console.log('');
  try {
    // Dynamic import of sqlite3
    const sqlite3 = await import('sqlite3');
    const { Database } = sqlite3.default || sqlite3;
    const db = new Database(dbPath);

    let continueQuerying = true;

    while (continueQuerying) {
      const queryAnswer = await inquirer.prompt({
        type: 'input',
        name: 'query',
        message: 'Enter SQL query ("back" to return to main menu, "exit" or "quit" to finish):',
        validate: (input: string) => {
          if (!input.trim()) {
            return 'Query cannot be empty';
          }
          return true;
        },
      });

      const query = queryAnswer.query.trim();

      // Check for back navigation
      if (query.toLowerCase() === 'back') {
        console.log('⬅️  Returning to main menu...');
        db.close();
        return;
      }

      if (query.toLowerCase() === 'exit' || query.toLowerCase() === 'quit') {
        continueQuerying = false;
        break;
      }

      try {
        console.log(`\n🔍 Executing: ${query}`);

        // Handle SQLite dot commands
        if (query.startsWith('.')) {
          await handleDotCommand(db, query);
        } else {
          // Check if it's a SELECT query or other query
          const isSelectQuery = query.toLowerCase().trim().startsWith('select');

          if (isSelectQuery) {
            // For SELECT queries, get all results
            const results = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
              db.all(query, (err: Error | null, rows: Record<string, unknown>[]) => {
                if (err) reject(err);
                else resolve(rows);
              });
            });

            console.log(`📊 Results: ${results.length} rows`);
            if (results.length > 0) {
              console.table(results.slice(0, 20)); // Show first 20 results
              if (results.length > 20) {
                console.log(`... and ${results.length - 20} more rows`);
              }
            } else {
              console.log('No results found.');
            }
          } else {
            // For other queries (INSERT, UPDATE, DELETE, etc.)
            const result = await new Promise<{ changes: number; lastID: number }>((resolve, reject) => {
              db.run(query, function (err: Error | null) {
                if (err) reject(err);
                else resolve({ changes: this.changes, lastID: this.lastID });
              });
            });

            console.log('✅ Query executed successfully!');
            if (result.changes > 0) {
              console.log(`📝 Affected rows: ${result.changes}`);
            }
            if (result.lastID) {
              console.log(`🆔 Last inserted ID: ${result.lastID}`);
            }
          }
        }

        console.log('');
      } catch (queryError) {
        console.error('❌ Query error:', (queryError as Error).message);
        console.log('');
      }
    }

    db.close();
    console.log('✅ SQL session ended.');
  } catch (error) {
    console.error('❌ Error connecting to database:', (error as Error).message);
  }
}
