#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { EbookSearch } from '../search';

const program = new Command();

program.name('search').description('Search ebooks by full-text content and metadata').version('1.0.0');

program
  .command('build')
  .description('Build search index from ebook files')
  .option('-d, --dir <path>', 'directory containing ebook files')
  .option('-f, --files <files...>', 'specific files to index (alternative to -d)')
  .option('-i, --index-file <path>', 'path to save search index file', './search-index.json')
  .option('-p, --pattern <pattern>', 'file pattern to match (e.g., *.pdf,*.epub)', '*.pdf,*.epub')
  .option('-v, --verbose', 'enable verbose output')
  .action(async (options) => {
    const { dir, files, indexFile, pattern, verbose } = options;

    let ebookFiles: string[] = [];

    if (files && files.length > 0) {
      // Use specific files provided
      ebookFiles = files;
      if (verbose) {
        console.log(`Indexing ${files.length} specific file(s)`);
        console.log(`Mode: append`);
      }
    } else if (dir) {
      // Use directory scanning
      if (!fs.existsSync(dir)) {
        console.error(`Error: Directory not found: ${dir}`);
        process.exit(1);
      }

      if (verbose) {
        console.log(`Building search index from directory: ${dir}`);
        console.log(`Index file: ${indexFile}`);
        console.log(`File pattern: ${pattern}`);
        console.log(`Mode: append`);
      }

      // Find ebook files
      ebookFiles = findEbookFiles(dir, pattern.split(','));
    } else {
      console.error('Error: Either -d (directory) or -f (files) must be specified');
      process.exit(1);
    }

    if (ebookFiles.length === 0) {
      console.log('No ebook files found.');
      return;
    }

    if (verbose) {
      console.log(`Found ${ebookFiles.length} ebook files`);
      ebookFiles.forEach((file) => console.log(`  ${file}`));
    }

    try {
      // Build index
      const search = new EbookSearch(indexFile);

      // Load existing index for appending
      if (search.indexExists()) {
        if (verbose) {
          console.log(`Loading existing index from: ${indexFile}`);
        }
        await search.loadIndex();
        const existingStats = search.getStats();
        if (verbose) {
          console.log(`Existing index contains ${existingStats.documentCount} documents`);
        }
      }

      await search.buildIndex(ebookFiles, { verbose, append: true });

      // Save index
      await search.saveIndex();

      const stats = search.getStats();
      console.log(`\nSearch index updated successfully!`);
      console.log(`Documents indexed: ${stats.documentCount}`);
      console.log(`Index file size: ${formatBytes(stats.indexSize)}`);
      console.log(`Index saved to: ${indexFile}`);
    } catch (error) {
      console.error('Failed to build search index:', (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('update')
  .description('Update search index incrementally from data.json')
  .option('-i, --index-file <path>', 'path to search index file', './search-index.json')
  .option('-d, --data-file <path>', 'path to data.json file (auto-detected from config.json if not specified)')
  .option('-f, --force', 'force full rebuild instead of incremental update')
  .option('-v, --verbose', 'enable verbose output')
  .option('--max-file-size <mb>', 'maximum file size in MB to process', '100')
  .option('--max-memory <value>', 'maximum memory usage (e.g., 2048, 8GB, 8192MB) before skipping files', '2048')
  .option('--no-skip-large', 'do not skip large files (may cause memory issues)')
  .option('--no-partial', 'do not extract partial content from large files')
  .option('--max-pages <number>', 'maximum pages to extract from PDFs (0 = unlimited)', '0')
  .option('--batch', 'use batch processing to handle large collections', true)
  .option('--no-batch', 'disable batch processing')
  .option('--batch-size <number>', 'number of files per batch', '10')
  .option('--batch-dir <path>', 'directory to store batch index files', './batch-indexes')
  .option('--max-files <number>', 'maximum number of files to process', '100')
  .action(async (options) => {
    const {
      indexFile,
      dataFile,
      force,
      verbose,
      maxFileSize,
      maxMemory,
      noSkipLarge,
      noPartial,
      maxPages,
      batch,
      noBatch,
      batchSize,
      batchDir,
      maxFiles,
    } = options;

    try {
      const batchEnabled = batch && !noBatch;

      if (verbose) {
        console.log(`Updating search index incrementally`);
        console.log(`Index file: ${indexFile}`);
        console.log(`Data file: ${dataFile || 'auto-detect from config.json'}`);
        console.log(`Force full rebuild: ${force ? 'yes' : 'no'}`);
        console.log(`Max file size: ${maxFileSize}MB`);
        console.log(`Max memory usage: ${maxMemory} (${parseMemoryValue(maxMemory)}MB)`);
        console.log(`Skip large files: ${!noSkipLarge}`);
        console.log(`Extract partial content: ${!noPartial}`);
        console.log(`Max pages: ${maxPages}`);
        const batchEnabled = batch && !noBatch;
        console.log(`Batch processing: ${batchEnabled ? 'enabled' : 'disabled'}`);
        if (batchEnabled) {
          console.log(`Batch size: ${batchSize}`);
          console.log(`Batch directory: ${batchDir}`);
        }
        console.log(`Max files to process: ${maxFiles}`);
      }

      // Perform incremental build
      const search = new EbookSearch(indexFile);
      const result = await search.buildIndexIncremental({
        dataFilePath: dataFile,
        verbose,
        forceFullRebuild: force,
        maxFileSizeMB: parseInt(maxFileSize, 10),
        maxMemoryUsageMB: parseMemoryValue(maxMemory),
        skipLargeFiles: !noSkipLarge,
        extractPartialContent: !noPartial,
        maxPages: parseInt(maxPages, 10),
        useBatchProcessing: batchEnabled,
        batchSize: parseInt(batchSize, 10),
        batchDir,
        maxFiles: parseInt(maxFiles, 10),
      });

      // Save index
      await search.saveIndex();

      const stats = search.getStats();

      console.log(`\nSearch index updated successfully!`);
      if (result.isFullRebuild) {
        console.log(`Full rebuild performed`);
      } else {
        console.log(`Incremental update performed`);
      }
      console.log(`Files added: ${result.added}`);
      console.log(`Files modified: ${result.modified}`);
      console.log(`Files deleted: ${result.deleted}`);
      console.log(`Files unchanged: ${result.unchanged}`);
      console.log(`Total files processed: ${result.totalProcessed}`);
      console.log(`Total documents in index: ${stats.documentCount}`);
      console.log(`Index file size: ${formatBytes(stats.indexSize)}`);

      // Display inverted index statistics
      if (result.invertedIndexTermCount !== undefined) {
        console.log(`Inverted index terms: ${result.invertedIndexTermCount}`);
      }
      if (result.topFrequentTerms && result.topFrequentTerms.length > 0) {
        console.log(`Top frequent terms:`);
        result.topFrequentTerms.forEach((term, index) => {
          console.log(`  ${index + 1}. "${term.term}" (${term.frequency} documents)`);
        });
      }

      // Display failed files information
      if (result.failed > 0) {
        console.log(`\n❌ Failed files: ${result.failed}`);
        if (result.failedFiles.length > 0) {
          console.log('Failed files list:');
          result.failedFiles.forEach((failed, index) => {
            console.log(`  ${index + 1}. ${path.basename(failed.path)}`);
            console.log(`     Error: ${failed.error}`);
            console.log(`     Path: ${failed.path}`);
          });
        }
      }
    } catch (error) {
      console.error('Failed to update search index:', (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('search')
  .description('Search the index for matching ebooks')
  .argument('<query>', 'search query')
  .option('-i, --index-file <path>', 'path to search index file', './search-index.json')
  .option('-l, --limit <number>', 'maximum number of results to return', '10')
  .option('-f, --fuzzy', 'enable fuzzy matching for approximate searches')
  .option('-v, --verbose', 'enable verbose output')
  .action(async (query, options) => {
    const { indexFile, limit, fuzzy, verbose } = options;

    try {
      const search = new EbookSearch(indexFile);

      // Check if index exists
      if (!search.indexExists()) {
        console.error(`Error: Search index file not found: ${indexFile}`);
        console.error('Please build the search index first using: search build -d <directory>');
        process.exit(1);
      }

      if (verbose) {
        console.log(`Loading search index from: ${indexFile}`);
      }

      // Perform search
      const { results, stats } = await search.search(query, {
        limit: parseInt(limit, 10),
        fuzzy: !!fuzzy,
        verbose: !!verbose,
      });

      if (verbose) {
        console.log(`\nSearch completed in ${stats.searchTime}ms`);
        console.log(`Total documents in index: ${stats.totalDocuments}`);
        console.log(`Results found: ${stats.resultsFound}\n`);
      }

      if (results.length === 0) {
        console.log(`No results found for query: "${query}"`);
        if (fuzzy) {
          console.log('Try disabling fuzzy search for exact matches.');
        } else {
          console.log('Try enabling fuzzy search (-f) for approximate matches.');
        }
        return;
      }

      // Display results
      console.log(`Results for "${query}":\n`);

      results.forEach((result, index) => {
        console.log(`${index + 1}. ${path.basename(result.filePath)}`);
        if (result.title) {
          console.log(`   Title: ${result.title}`);
        }
        if (result.author) {
          console.log(`   Author: ${result.author}`);
        }
        console.log(`   Type: ${result.type.toUpperCase()}`);
        console.log(`   Score: ${result.score}`);
        if (result.wordCount !== undefined) {
          console.log(`   Word Count: ${result.wordCount}`);
        }
        if (result.tokenCount !== undefined) {
          console.log(`   Token Count: ${result.tokenCount}`);
        }
        if (result.excerpt) {
          console.log(`   Excerpt: ${result.excerpt}`);
        }
        console.log(`   Path: ${result.filePath}\n`);
      });
    } catch (error) {
      console.error('Search failed:', (error as Error).message);
      process.exit(1);
    }
  });

program.parse();

if (!program.args.length) {
  program.help();
}

/**
 * Finds ebook files in a directory matching the given patterns
 */
function findEbookFiles(dir: string, patterns: string[]): string[] {
  const files: string[] = [];

  function scan(currentDir: string) {
    const items = fs.readdirSync(currentDir);

    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        scan(fullPath);
      } else {
        const ext = path.extname(item).toLowerCase();
        const patternExts = patterns.map((p) => p.replace('*', '').toLowerCase());
        if (patternExts.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  scan(dir);
  return files;
}

/**
 * Parses memory values with units (e.g., "8GB", "2048", "8192MB")
 */
function parseMemoryValue(value: string): number {
  const trimmed = value.trim().toUpperCase();

  // Check for unit suffixes
  const gbMatch = trimmed.match(/^(\d+(?:\.\d+)?)GB?$/);
  if (gbMatch) {
    return Math.round(parseFloat(gbMatch[1]) * 1024); // Convert GB to MB
  }

  const mbMatch = trimmed.match(/^(\d+(?:\.\d+)?)MB?$/);
  if (mbMatch) {
    return Math.round(parseFloat(mbMatch[1])); // Already in MB
  }

  // Assume plain number is in MB
  const numericValue = parseFloat(trimmed);
  if (!isNaN(numericValue)) {
    return Math.round(numericValue);
  }

  throw new Error(`Invalid memory value: ${value}. Use format like 2048, 8GB, or 8192MB`);
}

/**
 * Formats bytes into a human-readable format
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'kB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
