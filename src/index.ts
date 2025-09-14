import { Command } from 'commander';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { createInterface } from 'readline';
import { extractEpubMetadata } from './epubExtractor';
import { listEbookFiles } from './fileLister';
import { extractPdfMetadata } from './pdfExtractor';
import type { BookMetadata, Config, OutputData, ProcessingSummary } from './types';

const program = new Command();

const LOG_FILE = 'logs/errors.log';

function logError(message: string, filename?: string) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const logEntry = filename ? `[${timestamp}] ${filename}: ${message}\n` : `[${timestamp}] ${message}\n`;

  try {
    mkdirSync('logs', { recursive: true });
    appendFileSync(LOG_FILE, logEntry);
  } catch (error) {
    console.error(`Failed to write to log file: ${(error as Error).message}`);
  }
}

program
  .name('ebook-cli')
  .description('Extract metadata from PDF and EPUB files')
  .version('1.0.0')
  .option('-c, --config <path>', 'path to config file', 'config.json')
  .option('-o, --output <path>', 'output JSON file path', 'output/books.json')
  .option('-a, --all', 'scan and process all files (default: update mode - only process new files)')
  .option('-y, --yes', 'proceed without confirmation')
  .option('-l, --limit <number>', 'limit the number of files to process', parseInt)
  .option(
    '-m, --mode <number>',
    'extraction mode: 1=metadata only, 2=metadata+image, 3=update covers, 4=search by keyword',
    parseInt,
  );

program.parse();

const options = program.opts();

async function main() {
  try {
    // Read config
    const config: Config = JSON.parse(readFileSync(options.config, 'utf-8'));
    const folders: string[] = config.folders;
    const excludes: string[] = config.excludes ?? [];
    const outputPath: string = options.output ?? config.output;

    // List ebook files
    console.log('Scanning folders for ebooks...');
    const files = listEbookFiles(folders, excludes);
    console.log(`Found ${files.length} ebook files.`);

    // Read existing results if in update mode
    let existingResults: BookMetadata[] = [];
    let skippedFiles = 0;
    if (!options.all) {
      try {
        const existingData = JSON.parse(readFileSync(outputPath, 'utf-8')) as OutputData;
        existingResults = existingData.books || [];
        console.log(`Found ${existingResults.length} existing entries in ${outputPath}`);
      } catch {
        console.log('No existing results file found, will process all files');
      }
    }

    // Filter out already processed files
    const existingPaths = new Set(existingResults.map((book) => book.path));
    let filesToProcess = options.all ? files : files.filter((file) => !existingPaths.has(file));
    if (options.limit && options.limit > 0) {
      filesToProcess = filesToProcess.slice(0, options.limit);
    }
    skippedFiles = files.length - filesToProcess.length;

    if (!options.all && skippedFiles > 0) {
      console.log(`Skipping ${skippedFiles} already processed files`);
    }
    console.log(`Will process ${filesToProcess.length} files`);

    // Show preview
    console.log('\n=== PREVIEW MODE ===');
    console.log(`📁 Folders to scan: ${folders.join(', ')}`);
    console.log(`📄 Total files found: ${files.length}`);
    console.log(`🔄 Mode: ${options.all ? 'Full scan' : 'Update mode'}`);
    console.log(`✅ Files to process: ${filesToProcess.length}`);
    console.log(`⏭️  Files to skip: ${skippedFiles}`);
    console.log(`📊 Existing entries: ${existingResults.length}`);
    console.log(`📂 Output file: ${outputPath}`);

    // Ask for confirmation unless --yes is used
    let extractMetadata = true;
    let extractImage = false;
    let updateCoverImages = false;
    if (options.mode) {
      if (options.mode === 1) {
        extractMetadata = true;
        extractImage = false;
        updateCoverImages = false;
      } else if (options.mode === 2) {
        extractMetadata = true;
        extractImage = true;
        updateCoverImages = false;
      } else if (options.mode === 3) {
        extractMetadata = false;
        extractImage = false;
        updateCoverImages = true;
      } else if (options.mode === 4) {
        if (!options.keyword) {
          console.error('Mode 4 requires a keyword. Please use interactive mode to choose mode 4.');
          process.exit(1);
        }
        extractMetadata = false;
        extractImage = false;
        updateCoverImages = false;
      } else {
        console.log('Invalid mode. Defaulting to metadata only.');
        extractMetadata = true;
        extractImage = false;
        updateCoverImages = false;
      }
    } else if (!options.yes) {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      await new Promise<void>((resolve) => {
        rl.question(
          'Choose extraction mode:\n1. Extract only metadata\n2. Extract metadata and cover image\n3. Update cover images for existing books\n4. Search books by keyword in filename\nEnter 1, 2, 3, or 4: ',
          (mode) => {
            if (mode === '1') {
              extractMetadata = true;
              extractImage = false;
              updateCoverImages = false;
              rl.close();
              resolve();
            } else if (mode === '2') {
              extractMetadata = true;
              extractImage = true;
              updateCoverImages = false;
              rl.close();
              resolve();
            } else if (mode === '3') {
              extractMetadata = false;
              extractImage = false;
              updateCoverImages = true;
              rl.close();
              resolve();
            } else if (mode === '4') {
              rl.question('Enter search keyword: ', (keyword) => {
                options.keyword = keyword.trim();
                extractMetadata = false;
                extractImage = false;
                updateCoverImages = false;
                rl.close();
                resolve();
              });
            } else {
              console.log('Invalid choice. Defaulting to metadata only.');
              extractMetadata = true;
              extractImage = false;
              updateCoverImages = false;
              rl.close();
              resolve();
            }
          },
        );
      });
    } else {
      // Default to metadata only when --yes
      extractMetadata = true;
      extractImage = false;
      updateCoverImages = false;
    }

    // Handle mode 3: Update cover images
    if (updateCoverImages) {
      console.log('Updating cover images for existing books...');
      try {
        const existingData = JSON.parse(readFileSync(outputPath, 'utf-8')) as OutputData;
        const booksToUpdate = existingData.books.filter((book) => !book.imagePath);
        console.log(`Found ${booksToUpdate.length} books without cover images`);

        let updatedCount = 0;
        for (const book of booksToUpdate) {
          console.log(`Updating cover for: ${book.filename}`);
          try {
            let updatedBook: BookMetadata;
            if (book.type === 'pdf') {
              updatedBook = await extractPdfMetadata(book.path, true, false);
            } else if (book.type === 'epub') {
              updatedBook = await extractEpubMetadata(book.path, true, false);
            } else {
              continue;
            }

            if (updatedBook.imagePath) {
              book.imagePath = updatedBook.imagePath;
              updatedCount++;
            }
          } catch (error) {
            console.warn(`Failed to update cover for ${book.filename}: ${(error as Error).message}`);
          }
        }

        // Update summary
        existingData.summary.mode = 'update-cover';

        // Save updated data
        writeFileSync(outputPath, JSON.stringify(existingData, null, 2));
        console.log(`Updated ${updatedCount} cover images in ${outputPath}`);
      } catch (error) {
        console.error(`Error updating cover images: ${(error as Error).message}`);
        process.exit(1);
      }
      return; // Exit after mode 3
    }

    // Handle mode 4: Search by keyword in filename
    if (options.mode === 4) {
      console.log(`Searching for books with filename containing "${options.keyword}"...`);
      try {
        const fullDbPath = 'output/full-books.json';
        let dbPath = outputPath;
        try {
          readFileSync(fullDbPath, 'utf-8');
          dbPath = fullDbPath;
          console.log('Using full database for search');
        } catch {
          console.log('Using current database for search');
        }
        const existingData = JSON.parse(readFileSync(dbPath, 'utf-8')) as OutputData;
        const filteredBooks = existingData.books.filter((book) =>
          book.filename.toLowerCase().includes(options.keyword.toLowerCase()),
        );
        console.log(`Found ${filteredBooks.length} matching books`);

        // Create summary for search
        const summary: ProcessingSummary = {
          totalFiles: existingData.books.length,
          processedFiles: filteredBooks.length,
          skippedFiles: existingData.books.length - filteredBooks.length,
          pdfFiles: filteredBooks.filter((book) => book.type === 'pdf').length,
          epubFiles: filteredBooks.filter((book) => book.type === 'epub').length,
          failedFiles: 0,
          mode: 'search',
        };

        // Save filtered data
        const output: OutputData = {
          summary,
          books: filteredBooks,
        };
        writeFileSync(outputPath, JSON.stringify(output, null, 2));
        console.log(`Search results saved to ${outputPath}`);
      } catch (error) {
        console.error(`Error searching books: ${(error as Error).message}`);
        process.exit(1);
      }
      return; // Exit after mode 4
    }

    // Extract metadata
    const newResults: BookMetadata[] = [];
    let pdfCount = 0;
    let epubCount = 0;
    let failedFiles = 0;
    for (const file of filesToProcess) {
      console.log(`Processing: ${file}`);
      let metadata: BookMetadata;
      if (file.toLowerCase().endsWith('.pdf')) {
        metadata = await extractPdfMetadata(file, extractImage, extractMetadata);
        pdfCount++;
      } else if (file.toLowerCase().endsWith('.epub')) {
        metadata = await extractEpubMetadata(file, extractImage, extractMetadata);
        epubCount++;
      } else {
        continue; // shouldn't happen
      }
      if (metadata.error) {
        console.warn(`Warning: ${metadata.error}`);
        logError(metadata.error, file);
        failedFiles++;
      }
      newResults.push(metadata);
    }

    // Combine results
    const allResults = options.all ? newResults : [...existingResults, ...newResults];

    // Create summary
    const summary: ProcessingSummary = {
      totalFiles: files.length,
      processedFiles: newResults.length,
      skippedFiles: skippedFiles,
      pdfFiles: pdfCount,
      epubFiles: epubCount,
      failedFiles: failedFiles,
      mode: options.all ? 'full-scan' : 'update',
    };

    // Ensure output directory exists
    const outputDir = dirname(outputPath);
    mkdirSync(outputDir, { recursive: true });

    // Save to JSON with summary
    const output: OutputData = {
      summary,
      books: allResults,
    };
    writeFileSync(outputPath, JSON.stringify(output, null, 2));

    // If full scan, also save to full-books.json
    if (options.all) {
      const fullOutputPath = 'output/full-books.json';
      writeFileSync(fullOutputPath, JSON.stringify(output, null, 2));
      console.log(`Full database saved to ${fullOutputPath}`);
    }

    console.log(`Metadata saved to ${outputPath}`);
    console.log(
      `Summary: ${summary.processedFiles} processed, ${summary.skippedFiles} skipped, ${summary.failedFiles} failed`,
    );
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error(`Error: ${errorMessage}`);
    logError(`Main error: ${errorMessage}`);
    process.exit(1);
  }
}

main();
