#!/usr/bin/env node

import { spawn } from 'child_process';
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as v8 from 'v8';
import { EbookSearch } from '../search';

/**
 * Check if the Node.js process has enough heap space for the given memory requirement
 * If not, restart the process with increased heap size and exit the current process
 * @throws {ProcessRestartError} When process restart is initiated
 */
function ensureHeapSize(requiredMemoryMB: number): void {
  // Check if we're already in a restarted process (avoid infinite restart loop)
  if (process.env.HEAP_SIZE_RESTARTED) {
    return;
  }

  const heapStats = v8.getHeapStatistics();
  const currentHeapLimitMB = Math.round(heapStats.heap_size_limit / 1024 / 1024);

  // Add 20% buffer to the required memory
  const targetHeapSizeMB = Math.max(requiredMemoryMB * 1.2, 4096); // Minimum 4GB

  if (currentHeapLimitMB < targetHeapSizeMB) {
    console.log(`Current heap limit: ${currentHeapLimitMB}MB, required: ${targetHeapSizeMB}MB`);
    console.log(`Restarting with increased heap size...`);

    // Restart the process with increased heap size
    const nodeArgs = [`--max-old-space-size=${Math.round(targetHeapSizeMB)}`, ...process.argv.slice(1)];
    const child = spawn(process.execPath, nodeArgs, {
      stdio: 'inherit',
      env: { ...process.env, HEAP_SIZE_RESTARTED: 'true' },
    });

    child.on('exit', (code) => {
      process.exit(code || 0);
    });

    child.on('error', (error) => {
      console.error('Failed to restart process with increased heap size:', error.message);
      process.exit(1);
    });

    // Throw a special error to stop execution in the current call stack
    // This prevents the original process from continuing while the child runs
    throw new Error('PROCESS_RESTARTED');
  }
}

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
  .option('--max-memory <value>', 'maximum memory usage (e.g., 2048, 8GB, 8192MB) before skipping files', '8GB')
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
      const memoryLimitMB = parseMemoryValue(maxMemory);

      // Ensure Node.js has enough heap space for the specified memory limit
      try {
        ensureHeapSize(memoryLimitMB);
      } catch (error) {
        if (error instanceof Error && error.message === 'PROCESS_RESTARTED') {
          // Process is being restarted, stop execution in this process
          return;
        }
        throw error;
      }
      if (verbose) {
        console.log(`Updating search index incrementally`);
        console.log(`Index file: ${indexFile}`);
        console.log(`Data file: ${dataFile || 'auto-detect from config.json'}`);
        console.log(`Force full rebuild: ${force ? 'yes' : 'no'}`);
        console.log(`Max file size: ${maxFileSize}MB`);
        console.log(`Max memory usage: ${maxMemory} (${memoryLimitMB}MB)`);
        console.log(`Skip large files: ${!noSkipLarge}`);
        console.log(`Extract partial content: ${!noPartial}`);
        console.log(`Max pages: ${maxPages}`);
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
        maxMemoryUsageMB: memoryLimitMB,
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

program
  .command('summary')
  .description('Display search index statistics and analysis')
  .option('-i, --index-file <path>', 'path to search index file', './search-index.json')
  .option('-k, --top-k <number>', 'number of top frequent terms to display', '10')
  .option('-v, --verbose', 'enable verbose output with detailed statistics')
  .action(async (options) => {
    const { indexFile, topK, verbose } = options;
    const topKNumber = parseInt(topK, 10);

    try {
      const search = new EbookSearch(indexFile);

      // Check if index exists
      if (!search.indexExists()) {
        console.error(`Error: Search index file not found: ${indexFile}`);
        console.error('Please build the search index first using: ebook update');
        process.exit(1);
      }

      if (verbose) {
        console.log(`Loading search index from: ${indexFile}`);
      }

      // Load the index
      await search.loadIndex();

      // Get comprehensive statistics
      const stats = search.getIndexStatistics(topKNumber);

      // Display header
      console.log('📊 Search Index Summary');
      console.log('='.repeat(50));

      // Basic statistics
      console.log('\n📈 Basic Statistics:');
      console.log(`Total Documents: ${stats.totalDocuments.toLocaleString()}`);
      console.log(`Total Unique Terms: ${stats.totalTerms.toLocaleString()}`);
      console.log(
        `Singleton Terms: ${stats.singletonTermsCount.toLocaleString()} (${stats.singletonTermsPercentage}% of all terms)`,
      );
      console.log(`Total Tokens: ${stats.totalTokens.toLocaleString()}`);
      console.log(`Average Document Size: ${stats.averageDocumentSize.toLocaleString()} tokens`);
      console.log(`Average Term Frequency: ${stats.averageTermFrequency}`);
      console.log(`Average Term Frequency (without Singletons): ${stats.averageTermFrequencyWithoutSingletons}`);

      // Index file size
      const indexStats = search.getStats();
      console.log(`Index File Size: ${formatBytes(indexStats.indexSize)}`);

      // Term frequency percentiles
      console.log('\n📊 Term Frequency Distribution:');
      console.log(`25th Percentile: ${stats.percentiles.p25}`);
      console.log(`50th Percentile (Median): ${stats.percentiles.p50}`);
      console.log(`75th Percentile: ${stats.percentiles.p75}`);

      // Term frequency percentiles without singletons
      console.log('\n📊 Term Frequency Distribution (without Singleton terms):');
      console.log(`25th Percentile: ${stats.percentilesWithoutSingletons.p25}`);
      console.log(`50th Percentile (Median): ${stats.percentilesWithoutSingletons.p50}`);
      console.log(`75th Percentile: ${stats.percentilesWithoutSingletons.p75}`);

      // Top K terms
      console.log(`\n🔝 Top ${Math.min(topKNumber, stats.topTermsWithPercentages.length)} Most Frequent Terms:`);
      console.log('-'.repeat(60));
      console.log('Rank | Term                    | Frequency | Percentage');
      console.log('-'.repeat(60));

      stats.topTermsWithPercentages
        .slice(0, topKNumber)
        .forEach((term: { term: string; frequency: number; percentage: number }, index: number) => {
          const rank = (index + 1).toString().padStart(4, ' ');
          const termName = term.term.padEnd(23, ' ');
          const frequency = term.frequency.toString().padStart(9, ' ');
          const percentage = `${term.percentage}%`.padStart(10, ' ');
          console.log(`${rank} | ${termName} | ${frequency} | ${percentage}`);
        });

      // Verbose statistics
      if (verbose) {
        console.log('\n📋 Detailed Statistics:');

        // Term frequency distribution - optimized for large datasets
        const frequencies = stats.termFrequencies;

        // For very large datasets, use streaming calculations to avoid memory issues
        if (frequencies.length > 1000000) {
          console.log(
            `⚠️  Large dataset detected (${frequencies.length.toLocaleString()} terms). Using optimized calculations.`,
          );

          // Calculate min/max/avg using streaming approach
          let minFreq = Infinity;
          let maxFreq = -Infinity;
          let sum = 0;

          for (const freq of frequencies) {
            if (freq < minFreq) minFreq = freq;
            if (freq > maxFreq) maxFreq = freq;
            sum += freq;
          }

          const avgFreq = frequencies.length > 0 ? Math.round((sum / frequencies.length) * 100) / 100 : 0;

          console.log(`Minimum Term Frequency: ${minFreq}`);
          console.log(`Maximum Term Frequency: ${maxFreq}`);
          console.log(`Average Term Frequency: ${avgFreq}`);
          console.log(`Average Term Frequency (without Singletons): ${stats.averageTermFrequencyWithoutSingletons}`);

          // Use counter-based approach for frequency ranges
          const ranges = [
            { min: 1, max: 1, label: 'Singleton terms (frequency = 1)', count: 0 },
            { min: 2, max: 5, label: 'Rare terms (frequency 2-5)', count: 0 },
            { min: 6, max: 10, label: 'Uncommon terms (frequency 6-10)', count: 0 },
            { min: 11, max: 50, label: 'Common terms (frequency 11-50)', count: 0 },
            { min: 51, max: 99, label: 'Frequent terms (frequency 51-99)', count: 0 },
            { min: 100, max: 499, label: 'Very frequent terms (frequency 100-499)', count: 0 },
            { min: 500, max: 999, label: 'Highly frequent terms (frequency 500-999)', count: 0 },
            { min: 1000, max: Infinity, label: 'Extremely frequent terms (frequency ≥ 1000)', count: 0 },
          ];

          // Count frequencies in ranges
          for (const freq of frequencies) {
            for (const range of ranges) {
              if (freq >= range.min && freq <= range.max) {
                range.count++;
                break;
              }
            }
          }

          console.log('\nTerm Frequency Distribution:');
          ranges.forEach((range) => {
            const percentage =
              frequencies.length > 0 ? Math.round((range.count / frequencies.length) * 10000) / 100 : 0;
            console.log(`  ${range.label}: ${range.count.toLocaleString()} (${percentage}%)`);
          });
        } else {
          // Standard calculation for smaller datasets
          const minFreq = Math.min(...frequencies);
          const maxFreq = Math.max(...frequencies);
          const avgFreq =
            frequencies.length > 0
              ? Math.round((frequencies.reduce((sum: number, f: number) => sum + f, 0) / frequencies.length) * 100) /
                100
              : 0;

          console.log(`Minimum Term Frequency: ${minFreq}`);
          console.log(`Maximum Term Frequency: ${maxFreq}`);
          console.log(`Average Term Frequency: ${avgFreq}`);
          console.log(`Average Term Frequency (without Singletons): ${stats.averageTermFrequencyWithoutSingletons}`);

          // Frequency distribution ranges
          const ranges = [
            { min: 1, max: 1, label: 'Singleton terms (frequency = 1)' },
            { min: 2, max: 5, label: 'Rare terms (frequency 2-5)' },
            { min: 6, max: 10, label: 'Uncommon terms (frequency 6-10)' },
            { min: 11, max: 50, label: 'Common terms (frequency 11-50)' },
            { min: 51, max: 99, label: 'Frequent terms (frequency 51-99)' },
            { min: 100, max: 499, label: 'Very frequent terms (frequency 100-499)' },
            { min: 500, max: 999, label: 'Highly frequent terms (frequency 500-999)' },
            { min: 1000, max: Infinity, label: 'Extremely frequent terms (frequency ≥ 1000)' },
          ];

          console.log('\nTerm Frequency Distribution:');
          ranges.forEach((range) => {
            const count = frequencies.filter((f: number) => f >= range.min && f <= range.max).length;
            const percentage = frequencies.length > 0 ? Math.round((count / frequencies.length) * 10000) / 100 : 0;
            console.log(`  ${range.label}: ${count.toLocaleString()} (${percentage}%)`);
          });
        }

        // Memory and performance info
        const memoryUsage = process.memoryUsage();
        console.log('\n💾 Memory Usage:');
        console.log(`Heap Used: ${formatBytes(memoryUsage.heapUsed)}`);
        console.log(`Heap Total: ${formatBytes(memoryUsage.heapTotal)}`);
        console.log(`External: ${formatBytes(memoryUsage.external)}`);
      }

      console.log('\n✅ Index summary completed successfully!');
    } catch (error) {
      console.error('Failed to generate index summary:', (error as Error).message);
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
