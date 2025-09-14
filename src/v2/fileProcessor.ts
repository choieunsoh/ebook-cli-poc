/**
 * File processing utilities for ebook metadata extraction.
 */

import * as fs from 'fs';
import * as path from 'path';
import { extractEpubMetadata } from '../epubExtractor';
import { extractPDFMetadata, isMetadataComplete } from './pdfMetadataExtractor';
import type {
  BookMetadata,
  Config,
  EPUBMetadata,
  FileEntry,
  FileMetadata,
  ProcessingResult,
  ProcessingSummary,
  UserChoices,
} from './types';

/**
 * Loads configuration from config.json
 */
function loadConfiguration(): Config {
  const configPath = path.join(process.cwd(), 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('config.json not found');
  }
  const configData = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(configData);
}

/**
 * Loads previous processing results from data.json for incremental updates
 */
function loadPreviousData(config: Config): ProcessingResult[] {
  const dataPath = path.join(process.cwd(), config.outputDir, 'data.json');
  if (!fs.existsSync(dataPath)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  } catch {
    console.warn('⚠️  Failed to load previous data.json, starting fresh.');
    return [];
  }
}

/**
 * Creates a map of previously processed files for quick lookup
 */
function createPreviousFilesMap(previousResults: ProcessingResult[]): Map<string, Date> {
  const previousFiles = new Map<string, Date>();
  for (const prev of previousResults) {
    previousFiles.set(prev.fileMetadata.path, new Date(prev.fileMetadata.modified));
  }
  return previousFiles;
}

/**
 * Determines file extensions to scan for based on user choices
 */
function determineExtensions(choices: UserChoices): string[] {
  if (choices.fileType === 'pdf') {
    return ['.pdf'];
  } else if (choices.fileType === 'epub') {
    return ['.epub'];
  } else {
    return ['.pdf', '.epub'];
  }
}

/**
 * Collects files to process based on configuration and filters
 */
function collectFilesToProcess(
  config: Config,
  extensions: string[],
  previousFiles: Map<string, Date> | null,
): { filesToProcess: FileEntry[]; totalFilesFound: number } {
  const filesToProcess: FileEntry[] = [];
  let totalFilesFound = 0;

  for (const folder of config.includes) {
    if (!fs.existsSync(folder)) {
      console.warn(`⚠️  Configured folder does not exist: ${folder}`);
      continue;
    }

    const files = getAllFiles(folder, extensions, config.excludes, previousFiles);
    filesToProcess.push(...files);

    // Also count total files without filtering for summary
    if (previousFiles) {
      const allFiles = getAllFiles(folder, extensions, config.excludes, null);
      totalFilesFound += allFiles.length;
    } else {
      totalFilesFound += files.length;
    }
  }

  return { filesToProcess, totalFilesFound };
}

/**
 * Processes a batch of files and extracts metadata
 */
async function processFilesBatch(filesToProcess: FileEntry[], metadataType: string): Promise<ProcessingResult[]> {
  const results: ProcessingResult[] = [];
  let processedCount = 0;

  for (const entry of filesToProcess) {
    processedCount++;
    const filePath = path.join(entry.dir, entry.file);
    console.log(`\n📖 Processing item ${processedCount}/${filesToProcess.length}: ${entry.file}`);

    // Get file metadata
    const stats = fs.statSync(filePath);
    const fileMetadata: FileMetadata = {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      accessed: stats.atime,
      path: filePath,
    };

    let metadata: BookMetadata | null = null;

    if (metadataType !== 'file-metadata') {
      if (path.extname(entry.file).toLowerCase() === '.pdf') {
        metadata = await extractPDFMetadata(filePath);
        if (metadata && isMetadataComplete(metadata)) {
          console.log(
            `   ✅ Metadata extracted: ${metadata.title || 'Unknown Title'} by ${metadata.author || 'Unknown Author'}`,
          );
        } else {
          console.log(`   ⚠️  Failed to extract metadata.`);
        }
      } else if (path.extname(entry.file).toLowerCase() === '.epub') {
        try {
          const epubResult = await extractEpubMetadata(filePath, metadataType === 'metadata+cover');
          if (epubResult.metadata) {
            metadata = epubResult.metadata;
            console.log(
              `   ✅ Metadata extracted: ${metadata.title || 'Unknown Title'} by ${(metadata as EPUBMetadata).creator || 'Unknown Creator'}`,
            );
            if (epubResult.imagePath) {
              console.log(`   🖼️  Cover image extracted: ${epubResult.imagePath}`);
            }
          } else {
            console.log(`   ⚠️  Failed to extract metadata.`);
            if (epubResult.error) {
              console.log(`      Error: ${epubResult.error}`);
            }
          }
        } catch (error) {
          console.log(`   ❌ Error processing EPUB: ${(error as Error).message}`);
        }
      }
    } else {
      console.log(`   📄 File metadata extracted (ebook metadata skipped)`);
    }

    results.push({
      file: entry.file,
      type: path.extname(entry.file).toLowerCase() === '.pdf' ? 'pdf' : 'epub',
      fileMetadata,
      metadata,
    });
  }

  return results;
}

/**
 * Saves processing results to multiple output files
 */
function saveResults(results: ProcessingResult[], previousResults: ProcessingResult[], config: Config): void {
  // Append current results to previous results for cumulative data
  previousResults.push(...results);

  // Save results to configured output path with timestamp
  const now = new Date();
  const timestamp = formatTimestamp(now, config.timestampFormat);
  const outputWithTimestampPath = path.join(
    process.cwd(),
    config.outputDir,
    config.output.replace(/\.json$/, `-${timestamp}.json`),
  );
  fs.mkdirSync(path.dirname(outputWithTimestampPath), { recursive: true });
  fs.writeFileSync(outputWithTimestampPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Results saved to ${outputWithTimestampPath}`);

  // Save to base output path
  const baseOutputPath = path.join(process.cwd(), config.outputDir, config.output);
  fs.mkdirSync(path.dirname(baseOutputPath), { recursive: true });
  fs.writeFileSync(baseOutputPath, JSON.stringify(results, null, 2));
  console.log(`💾 Results saved to ${baseOutputPath}`);

  // Create timestamped backup in backup folder
  const dataPath = path.join(process.cwd(), config.outputDir, 'data.json');
  if (fs.existsSync(dataPath)) {
    const backupDir = path.join(process.cwd(), config.outputDir, 'backup');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupTimestamp = formatTimestamp(now, 'YYYYMMDDHHmmss');
    const backupPath = path.join(backupDir, `data-${backupTimestamp}.json`);
    fs.copyFileSync(dataPath, backupPath);
    console.log(`💾 Backup created: ${backupPath}`);
  }

  // Save cumulative data to data.json for incremental updates
  fs.writeFileSync(dataPath, JSON.stringify(previousResults, null, 2));
  console.log(`💾 Incremental data saved to ${dataPath}`);
}

/**
 * Generates a summary of processing results
 */
function generateProcessingSummary(
  results: ProcessingResult[],
  totalFilesFound: number,
  skippedFiles: number,
  startTime: number,
): ProcessingSummary {
  const processedFiles = results.length;
  const successfulExtractions = results.filter((r) => r.metadata !== null).length;
  const failedExtractions = processedFiles - successfulExtractions;
  const pdfFiles = results.filter((r) => r.type === 'pdf').length;
  const epubFiles = results.filter((r) => r.type === 'epub').length;
  const totalSize = results.reduce((sum, r) => sum + r.fileMetadata.size, 0);
  const averageFileSize = processedFiles > 0 ? totalSize / processedFiles : 0;
  const processingTime = Date.now() - startTime;
  const filesPerSecond = processingTime > 0 ? (processedFiles / processingTime) * 1000 : 0;
  const averageTimePerFile = processedFiles > 0 ? processingTime / processedFiles : 0;
  const totalDataProcessed = totalSize;
  const dataThroughput = processingTime > 0 ? (totalDataProcessed / processingTime) * 1000 : 0; // bytes per second

  return {
    totalFiles: totalFilesFound,
    processedFiles,
    skippedFiles,
    successfulExtractions,
    failedExtractions,
    pdfFiles,
    epubFiles,
    totalSize,
    averageFileSize,
    processingTime,
    filesPerSecond,
    averageTimePerFile,
    totalDataProcessed,
    dataThroughput,
  };
}

/**
 * Displays a formatted summary of processing results
 */
function displayProcessingSummary(summary: ProcessingSummary): void {
  console.log('\n📊 Processing Summary');
  console.log('===================');
  console.log(`📁 Total files found: ${summary.totalFiles.toLocaleString()}`);
  console.log(`✅ Files processed: ${summary.processedFiles.toLocaleString()}`);
  console.log(`⏭️  Files skipped: ${summary.skippedFiles.toLocaleString()}`);
  console.log(`📄 PDF files: ${summary.pdfFiles.toLocaleString()}`);
  console.log(`📖 EPUB files: ${summary.epubFiles.toLocaleString()}`);
  console.log(`🎯 Successful extractions: ${summary.successfulExtractions.toLocaleString()}`);
  console.log(`❌ Failed extractions: ${summary.failedExtractions.toLocaleString()}`);
  console.log(`💾 Total size: ${(summary.totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`📏 Average file size: ${(summary.averageFileSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`⏱️  Processing time: ${summary.processingTime}ms`);

  if (summary.processedFiles > 0) {
    const successRate = ((summary.successfulExtractions / summary.processedFiles) * 100).toFixed(1);
    console.log(`📈 Success rate: ${successRate}%`);
  }

  // Performance statistics
  console.log('\n⚡ Performance Statistics');
  console.log('========================');
  console.log(`🚀 Files per second: ${summary.filesPerSecond.toFixed(2)}`);
  console.log(`⏱️  Average time per file: ${summary.averageTimePerFile.toFixed(2)}ms`);
  console.log(`💾 Data processed: ${(summary.totalDataProcessed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`📊 Data throughput: ${(summary.dataThroughput / 1024 / 1024).toFixed(2)} MB/s`);
}

/**
 * Formats a date according to the configured timestamp format
 */
function formatTimestamp(date: Date, format: string): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return format
    .replace(/YYYY/g, String(year))
    .replace(/MM/g, month)
    .replace(/DD/g, day)
    .replace(/HH/g, hours)
    .replace(/mm/g, minutes)
    .replace(/ss/g, seconds);
}

/**
 * Recursively collects all files from a directory and its subdirectories.
 * @param dirPath - The directory path to scan
 * @param limit - Optional maximum number of files to collect (early exit when reached)
 * @param extensions - Optional array of file extensions to filter by (e.g., ['.pdf', '.epub'])
 * @param excludes - Optional array of folder paths to exclude
 * @param previousFiles - Optional map of previously processed files (path -> modified date)
 */
function getAllFiles(
  dirPath: string,
  extensions?: string[],
  excludes?: string[],
  previousFiles?: Map<string, Date> | null,
): FileEntry[] {
  const files: FileEntry[] = [];

  function scan(dir: string): boolean {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        // Skip excluded directories
        if (excludes && excludes.some((exclude) => fullPath.startsWith(exclude))) {
          continue;
        }
        if (!scan(fullPath)) return false;
      } else {
        const fileName = item;
        // Check extension filter
        if (!extensions || extensions.some((ext) => path.extname(fileName).toLowerCase() === ext.toLowerCase())) {
          // Check if already processed and unchanged
          if (previousFiles) {
            const prevModified = previousFiles.get(fullPath);
            if (prevModified && prevModified.getTime() === stat.mtime.getTime()) {
              continue; // Skip unchanged file
            }
          }
          files.push({ file: fileName, dir: dir });
        }
      }
    }
    return true;
  }

  scan(dirPath);
  return files;
}

/**
 * Processes the ebook files based on user choices.
 * @param choices - The user's configuration choices
 */
export async function processFiles(choices: UserChoices) {
  console.log('\n🔍 Scanning for files...');

  // Load configuration and previous data
  const config = loadConfiguration();
  const previousResults = choices.updateType === 'diff' ? loadPreviousData(config) : [];
  const previousFiles = choices.updateType === 'diff' ? createPreviousFilesMap(previousResults) : null;

  // Development limit for processing files
  const LIMIT = 100;

  // Determine file extensions and collect files to process
  const extensions = determineExtensions(choices);
  const { filesToProcess, totalFilesFound } = collectFilesToProcess(config, extensions, previousFiles);

  if (filesToProcess.length === 0) {
    console.log('ℹ️  No matching files found.');
    return;
  }

  console.log(`📁 Found ${filesToProcess.length} file(s) to process.`);
  console.log(`📁 Processing up to ${LIMIT} file(s).`);

  // If file-metadata only, save file list and skip processing
  if (choices.metadataType === 'file-metadata') {
    const filesJsonPath = path.join(process.cwd(), config.outputDir, 'files.json');
    fs.mkdirSync(path.dirname(filesJsonPath), { recursive: true });
    fs.writeFileSync(filesJsonPath, JSON.stringify(filesToProcess, null, 2));
    console.log(`\n💾 File list saved to ${filesJsonPath}`);

    // Display summary for file-metadata mode
    const summary = generateProcessingSummary([], totalFilesFound, 0, Date.now());
    displayProcessingSummary(summary);
    return;
  }

  // Track processing start time
  const startTime = Date.now();

  // Process files and save results
  const results = await processFilesBatch(filesToProcess.slice(0, LIMIT), choices.metadataType);
  saveResults(results, previousResults, config);

  // Calculate skipped files (for incremental updates)
  const skippedFiles = choices.updateType === 'diff' ? totalFilesFound - filesToProcess.length : 0;

  // Generate and display summary
  const summary = generateProcessingSummary(results, totalFilesFound, skippedFiles, startTime);
  displayProcessingSummary(summary);
}
