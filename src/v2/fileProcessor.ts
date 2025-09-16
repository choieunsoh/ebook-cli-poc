/**
 * File processing utilities for ebook metadata extraction.
 */

import * as fs from 'fs';
import inquirer from 'inquirer';
import * as path from 'path';
import { extractEpubMetadata } from '../epubMetadataExtractor';
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

// Global error handler for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Promise Rejection detected:');
  console.error('Reason:', reason);
  console.error('Promise:', promise);
  // Don't exit the process, just log the error
});

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

    const files = getAllFiles(folder, extensions, [...config.excludes, config.duplicateDir], previousFiles);
    filesToProcess.push(...files);

    totalFilesFound += files.length;
  }

  return { filesToProcess, totalFilesFound };
}

/**
 * Handles duplicate files by moving them to the duplicate directory
 */
function handleDuplicateFiles(
  filesToProcess: FileEntry[],
  config: Config,
  previousResults: ProcessingResult[] = [],
): FileEntry[] {
  // Handle both absolute and relative paths for duplicateDir
  const duplicateDir = path.isAbsolute(config.duplicateDir)
    ? config.duplicateDir
    : path.join(process.cwd(), config.duplicateDir);

  fs.mkdirSync(duplicateDir, { recursive: true });

  // Create map of already processed files (by filename and by full path)
  const processedFilesByName = new Map<string, ProcessingResult>();
  const processedFilesByPath = new Map<string, ProcessingResult>();

  for (const result of previousResults) {
    const fileName = result.file.toLowerCase();
    processedFilesByName.set(fileName, result);
    processedFilesByPath.set(result.fileMetadata.path, result);
  }

  // Separate files into duplicates and unique files
  const uniqueFiles: FileEntry[] = [];
  let duplicatesMoved = 0;

  for (const fileEntry of filesToProcess) {
    const fileName = fileEntry.file.toLowerCase();
    const fullPath = path.join(fileEntry.dir, fileEntry.file);

    // Check if file was already processed (by path or by name)
    const existingByPath = processedFilesByPath.get(fullPath);
    const existingByName = processedFilesByName.get(fileName);

    if (existingByPath) {
      // Same file path already processed - move to duplicates
      const sourcePath = fullPath;
      const destPath = path.join(duplicateDir, fileEntry.file);

      try {
        // If destination file already exists, add a suffix
        let finalDestPath = destPath;
        let counter = 1;
        while (fs.existsSync(finalDestPath)) {
          const ext = path.extname(fileEntry.file);
          const baseName = path.basename(fileEntry.file, ext);
          finalDestPath = path.join(duplicateDir, `${baseName}_${counter}${ext}`);
          counter++;
        }

        fs.renameSync(sourcePath, finalDestPath);
        console.log(`📁 Moved duplicate (already processed): ${sourcePath} → ${finalDestPath}`);
        duplicatesMoved++;
      } catch (error) {
        console.error(`❌ Failed to move duplicate ${sourcePath}: ${(error as Error).message}`);
      }
    } else if (existingByName) {
      // Same filename already processed - move to duplicates
      const sourcePath = fullPath;
      const destPath = path.join(duplicateDir, fileEntry.file);

      try {
        // If destination file already exists, add a suffix
        let finalDestPath = destPath;
        let counter = 1;
        while (fs.existsSync(finalDestPath)) {
          const ext = path.extname(fileEntry.file);
          const baseName = path.basename(fileEntry.file, ext);
          finalDestPath = path.join(duplicateDir, `${baseName}_${counter}${ext}`);
          counter++;
        }

        fs.renameSync(sourcePath, finalDestPath);
        console.log(`📁 Moved duplicate (same name as processed): ${sourcePath} → ${finalDestPath}`);
        duplicatesMoved++;
      } catch (error) {
        console.error(`❌ Failed to move duplicate ${sourcePath}: ${(error as Error).message}`);
      }
    } else {
      // Check for duplicates among the current batch
      uniqueFiles.push(fileEntry);
    }
  }

  // Now handle duplicates within the remaining unique files (same logic as before)
  const fileGroups = new Map<string, FileEntry[]>();
  for (const fileEntry of uniqueFiles) {
    const fileName = fileEntry.file.toLowerCase();
    if (!fileGroups.has(fileName)) {
      fileGroups.set(fileName, []);
    }
    fileGroups.get(fileName)!.push(fileEntry);
  }

  const finalUniqueFiles: FileEntry[] = [];

  for (const [, files] of fileGroups) {
    if (files.length === 1) {
      // No duplicate, keep the file
      finalUniqueFiles.push(files[0]);
    } else {
      // Handle duplicates: keep the first one, move the rest
      finalUniqueFiles.push(files[0]); // Keep the first file

      for (let i = 1; i < files.length; i++) {
        const duplicate = files[i];
        const sourcePath = path.join(duplicate.dir, duplicate.file);
        const destPath = path.join(duplicateDir, duplicate.file);

        try {
          // If destination file already exists, add a suffix
          let finalDestPath = destPath;
          let counter = 1;
          while (fs.existsSync(finalDestPath)) {
            const ext = path.extname(duplicate.file);
            const baseName = path.basename(duplicate.file, ext);
            finalDestPath = path.join(duplicateDir, `${baseName}_${counter}${ext}`);
            counter++;
          }

          fs.renameSync(sourcePath, finalDestPath);
          console.log(`📁 Moved duplicate: ${sourcePath} → ${finalDestPath}`);
          duplicatesMoved++;
        } catch (error) {
          console.error(`❌ Failed to move duplicate ${sourcePath}: ${(error as Error).message}`);
        }
      }
    }
  }

  if (duplicatesMoved > 0) {
    console.log(`\n📁 Moved ${duplicatesMoved} duplicate file(s) to ${duplicateDir}`);
  }

  return finalUniqueFiles;
}

/**
 * Processes a batch of files and extracts metadata
 */
async function* processFilesBatchGenerator(
  filesToProcess: FileEntry[],
  metadataType: string,
  batchSize: number = 10,
  config: Config,
  previousResults: ProcessingResult[],
  overallStartTime: number,
  sessionTimestamp: string,
) {
  const totalBatches = Math.ceil(filesToProcess.length / batchSize);

  for (let i = 0; i < filesToProcess.length; i += batchSize) {
    const batch = filesToProcess.slice(i, i + batchSize);
    const batchStartTime = Date.now();
    console.log(`\n🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${totalBatches} (${batch.length} files)`);

    const batchResults: ProcessingResult[] = [];
    let processedCount = i;

    for (const entry of batch) {
      try {
        processedCount++;
        const filePath = path.join(entry.dir, entry.file);
        console.log(`📖 Processing item ${processedCount}/${filesToProcess.length}: ${entry.file}`);

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
            const timeoutPromise = new Promise<BookMetadata | null>(
              (resolve) => setTimeout(() => resolve(null), 60000), // 60 second timeout
            );

            try {
              // Wrap the PDF extraction in a try-catch to handle any library-specific errors
              const extractPromise = (async () => {
                try {
                  return await extractPDFMetadata(filePath);
                } catch (extractError) {
                  console.error(`   ❌ PDF extraction error for ${entry.file}:`, extractError);
                  return null;
                }
              })();

              metadata = await Promise.race([extractPromise, timeoutPromise]);

              if (metadata && isMetadataComplete(metadata)) {
                console.log(
                  `   ✅ Metadata extracted: ${metadata.title || 'Unknown Title'} by ${metadata.author || 'Unknown Author'}`,
                );
              } else {
                console.log(`   ⚠️  Failed to extract metadata or timed out.`);
              }
            } catch (error) {
              console.error(`   ❌ Unexpected error processing PDF ${entry.file}:`, error);
              metadata = null;
            }
          } else if (path.extname(entry.file).toLowerCase() === '.epub') {
            const timeoutPromise = new Promise<{ metadata: BookMetadata | null; imagePath?: string; error?: string }>(
              (resolve) => setTimeout(() => resolve({ metadata: null, error: 'Timeout' }), 60000), // 60 second timeout
            );
            try {
              const epubResult = await Promise.race([
                extractEpubMetadata(filePath, metadataType === 'metadata+cover'),
                timeoutPromise,
              ]);
              if (epubResult.metadata) {
                metadata = epubResult.metadata;
                console.log(
                  `   ✅ Metadata extracted: ${metadata.title || 'Unknown Title'} by ${(metadata as EPUBMetadata).creator || 'Unknown Creator'}`,
                );
                if (epubResult.imagePath) {
                  console.log(`   🖼️  Cover image extracted: ${epubResult.imagePath}`);
                }
              } else {
                console.log(`   ⚠️  Failed to extract metadata or timed out.`);
                if (epubResult.error) {
                  console.log(`      Error: ${epubResult.error}`);
                }
              }
            } catch (error) {
              console.error(`   ❌ Unexpected error processing EPUB ${entry.file}:`, error);
              metadata = null;
            }
          }
        } else {
          console.log(`   📄 File metadata extracted (ebook metadata skipped)`);
        }

        const result: ProcessingResult = {
          file: entry.file,
          type: path.extname(entry.file).toLowerCase() === '.pdf' ? 'pdf' : 'epub',
          fileMetadata,
          metadata,
        };

        batchResults.push(result);
      } catch (fileError) {
        console.error(`🚨 Critical error processing file ${entry.file}:`, fileError);
        // Create a result with null metadata to indicate failure
        const errorResult: ProcessingResult = {
          file: entry.file,
          type: path.extname(entry.file).toLowerCase() === '.pdf' ? 'pdf' : 'epub',
          fileMetadata: {
            size: 0,
            created: new Date(),
            modified: new Date(),
            accessed: new Date(),
            path: path.join(entry.dir, entry.file),
          },
          metadata: null,
        };
        batchResults.push(errorResult);
      }
    }

    // Save batch results incrementally
    const currentResults = [...previousResults, ...batchResults];
    const batchNumber = Math.floor(i / batchSize) + 1;
    saveBatchResults(batchResults, currentResults, config, batchNumber, sessionTimestamp);

    // Show batch summary
    generateBatchSummary(
      batchResults,
      batchNumber,
      totalBatches,
      batchStartTime,
      overallStartTime,
      filesToProcess.length,
    );

    yield batchResults;
  }
}

/**
 * Saves processing results to multiple output files
 */
function saveResults(results: ProcessingResult[], previousResults: ProcessingResult[], config: Config): void {
  // Deduplicate results based on file path
  const uniqueResultsMap = new Map<string, ProcessingResult>();

  // Add previous results first
  for (const result of previousResults) {
    uniqueResultsMap.set(result.fileMetadata.path, result);
  }

  // Add new results, overwriting if path already exists
  for (const result of results) {
    uniqueResultsMap.set(result.fileMetadata.path, result);
  }

  const uniqueResults = Array.from(uniqueResultsMap.values());

  // Save results to configured output path with timestamp
  const now = new Date();
  const timestamp = formatTimestamp(now, config.timestampFormat);
  const outputWithTimestampPath = path.join(
    process.cwd(),
    config.outputDir,
    config.output.replace(/\.json$/, `-${timestamp}.json`),
  );
  fs.mkdirSync(path.dirname(outputWithTimestampPath), { recursive: true });
  fs.writeFileSync(outputWithTimestampPath, JSON.stringify(uniqueResults, null, 2));
  console.log(`\n💾 Final results saved to ${outputWithTimestampPath}`);

  // Save to base output path
  const baseOutputPath = path.join(process.cwd(), config.outputDir, config.output);
  fs.mkdirSync(path.dirname(baseOutputPath), { recursive: true });
  fs.writeFileSync(baseOutputPath, JSON.stringify(uniqueResults, null, 2));
  console.log(`💾 Final results saved to ${baseOutputPath}`);

  // Create timestamped backup in backup folder
  const dataPath = path.join(process.cwd(), config.outputDir, 'data.json');
  if (fs.existsSync(dataPath)) {
    const backupDir = path.join(process.cwd(), config.outputDir, 'backup');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupTimestamp = formatTimestamp(now, 'YYYYMMDDHHmmss');
    const backupPath = path.join(backupDir, `data-${backupTimestamp}.json`);
    fs.copyFileSync(dataPath, backupPath);
    console.log(`💾 Final backup created: ${backupPath}`);
  }
}

/**
 * Saves batch results incrementally during processing
 */
function saveBatchResults(
  batchResults: ProcessingResult[],
  currentResults: ProcessingResult[],
  config: Config,
  batchNumber: number,
  sessionTimestamp: string,
): void {
  // Save current cumulative results to data.json for incremental updates
  const dataPath = path.join(process.cwd(), config.outputDir, 'data.json');
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.writeFileSync(dataPath, JSON.stringify(currentResults, null, 2));

  // Save individual batch results to timestamped batches subfolder
  const batchFileName = `batch-${batchNumber.toString().padStart(3, '0')}.json`;
  const batchSubfolder = path.join(process.cwd(), config.outputDir, `batches-${sessionTimestamp}`);
  const batchFilePath = path.join(batchSubfolder, batchFileName);
  fs.mkdirSync(batchSubfolder, { recursive: true });
  fs.writeFileSync(batchFilePath, JSON.stringify(batchResults, null, 2));

  console.log(`💾 Batch results saved incrementally (${batchResults.length} files)`);
  console.log(`💾 Batch ${batchNumber} saved to batches-${sessionTimestamp}/${batchFileName}`);
}

/**
 * Generates a summary for a single batch of processing results
 */
function generateBatchSummary(
  batchResults: ProcessingResult[],
  batchNumber: number,
  totalBatches: number,
  startTime: number,
  overallStartTime: number,
  totalFiles: number,
): void {
  const processedFiles = batchResults.length;
  const successfulExtractions = batchResults.filter((r) => r.metadata !== null).length;
  const failedExtractions = processedFiles - successfulExtractions;
  const pdfFiles = batchResults.filter((r) => r.type === 'pdf').length;
  const epubFiles = batchResults.filter((r) => r.type === 'epub').length;
  const totalSize = batchResults.reduce((sum, r) => sum + r.fileMetadata.size, 0);
  const batchProcessingTime = Date.now() - startTime;
  const overallProcessingTime = Date.now() - overallStartTime;

  // Calculate progress and estimates
  const filesProcessedSoFar = (batchNumber - 1) * processedFiles + processedFiles;
  const progressPercent = (filesProcessedSoFar / totalFiles) * 100;
  const avgTimePerFile = overallProcessingTime / filesProcessedSoFar;
  const remainingFiles = totalFiles - filesProcessedSoFar;
  const estimatedRemainingTime = remainingFiles * avgTimePerFile;
  const estimatedCompletion = new Date(Date.now() + estimatedRemainingTime);

  console.log(`\n📦 Batch ${batchNumber}/${totalBatches} Summary`);
  console.log('=====================================');
  console.log(`📁 Files in batch: ${processedFiles.toLocaleString()}`);
  console.log(`📄 PDF files: ${pdfFiles.toLocaleString()}`);
  console.log(`📖 EPUB files: ${epubFiles.toLocaleString()}`);
  console.log(`🎯 Successful extractions: ${successfulExtractions.toLocaleString()}`);
  console.log(`❌ Failed extractions: ${failedExtractions.toLocaleString()}`);
  console.log(`💾 Batch size: ${formatBytes(totalSize)}`);
  console.log(`⏱️  Batch processing time: ${formatDuration(batchProcessingTime)}`);

  if (processedFiles > 0) {
    const successRate = ((successfulExtractions / processedFiles) * 100).toFixed(1);
    console.log(`📈 Batch success rate: ${successRate}%`);
  }

  // Progress and time estimates
  console.log(
    `\n📊 Progress: ${progressPercent.toFixed(1)}% (${filesProcessedSoFar.toLocaleString()}/${totalFiles.toLocaleString()} files)`,
  );
  console.log(`⏱️  Elapsed time: ${formatDuration(overallProcessingTime)}`);
  console.log(`⏳ Estimated remaining: ${formatDuration(estimatedRemainingTime)}`);
  console.log(`🎯 Estimated completion: ${estimatedCompletion.toLocaleString()}`);
}

/**
 * Formats bytes into a human-readable format (B, kB, MB, GB, TB)
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'kB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Formats data throughput (bytes per second) into human-readable format
 */
function formatThroughput(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return '0 B/s';

  const k = 1024;
  const sizes = ['B/s', 'kB/s', 'MB/s', 'GB/s', 'TB/s'];
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));

  return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Formats milliseconds into a human-readable duration string
 */
function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${milliseconds}ms`;
  }

  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
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
  console.log(`💾 Total size: ${formatBytes(summary.totalSize)}`);
  console.log(`📏 Average file size: ${formatBytes(summary.averageFileSize)}`);
  console.log(`⏱️  Total processing time: ${formatDuration(summary.processingTime)}`);

  if (summary.processedFiles > 0) {
    const successRate = ((summary.successfulExtractions / summary.processedFiles) * 100).toFixed(1);
    console.log(`📈 Success rate: ${successRate}%`);
  }

  // Performance statistics
  console.log('\n⚡ Performance Statistics');
  console.log('========================');
  console.log(`🚀 Files per second: ${summary.filesPerSecond.toFixed(2)}`);
  console.log(`⏱️  Average time per file: ${formatDuration(summary.averageTimePerFile)}`);
  console.log(`💾 Data processed: ${formatBytes(summary.totalDataProcessed)}`);
  console.log(`📊 Data throughput: ${formatThroughput(summary.dataThroughput)}`);

  // Time breakdown
  console.log('\n⏰ Time Processing Summary');
  console.log('==========================');
  const processingTimeFormatted = formatDuration(summary.processingTime);
  const scanningTime = summary.processingTime * 0.1; // Rough estimate: 10% for scanning
  const processingTimePerFile = summary.averageTimePerFile;
  const savingTime = summary.processingTime * 0.05; // Rough estimate: 5% for saving

  console.log(`🔍 File scanning: ~${formatDuration(scanningTime)} (estimated)`);
  console.log(
    `📖 Metadata extraction: ~${formatDuration(summary.processingTime - scanningTime - savingTime)} (${summary.processedFiles} files)`,
  );
  console.log(`💾 File saving: ~${formatDuration(savingTime)} (estimated)`);
  console.log(`📊 Total elapsed: ${processingTimeFormatted}`);

  if (summary.processedFiles > 0) {
    console.log(`\n📈 Per-File Breakdown:`);
    console.log(`   Average extraction time: ${formatDuration(processingTimePerFile)}`);
    console.log(`   Fastest expected: ${formatDuration(processingTimePerFile * 0.5)} (estimated)`);
    console.log(`   Slowest expected: ${formatDuration(processingTimePerFile * 2)} (estimated)`);
  }
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
            if (prevModified) {
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
 * @param sessionTimestamp - The session timestamp for batch directory naming
 * @param skipConfirmation - Whether to skip the confirmation prompt (for testing)
 */
export async function processFiles(choices: UserChoices, sessionTimestamp?: string, skipConfirmation = false) {
  console.log('\n🔍 Scanning for files...');

  // Load configuration and previous data
  const config = loadConfiguration();
  const previousResults = loadPreviousData(config); // Always load previous results for duplicate checking
  const previousFiles = choices.updateType === 'diff' ? createPreviousFilesMap(previousResults) : null;

  // Determine file extensions and collect files to process
  const extensions = determineExtensions(choices);
  const { filesToProcess: initialFilesToProcess, totalFilesFound } = collectFilesToProcess(
    config,
    extensions,
    previousFiles,
  );

  if (initialFilesToProcess.length === 0) {
    console.log('ℹ️  No matching files found.');
    return;
  }

  // Handle duplicate files
  const filesToProcess = handleDuplicateFiles(initialFilesToProcess, config, previousResults);

  console.log(`📁 Found ${previousResults.length} previously processed file(s).`);
  console.log(`📁 Found ${filesToProcess.length} file(s) to process after duplicate handling.`);
  console.log(
    `📁 Processing all files in batches of ${choices.batchSize}, total of ${Math.ceil(filesToProcess.length / choices.batchSize)} ${Math.ceil(filesToProcess.length / choices.batchSize) === 1 ? 'batch' : 'batches'}.`,
  );

  // Ask for confirmation before proceeding with processing
  if (!skipConfirmation) {
    const confirmationAnswer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Do you want to proceed with processing these files?',
        default: true,
      },
    ]);

    if (!confirmationAnswer.proceed) {
      console.log('\n❌ Processing cancelled by user.');
      return;
    }
  }

  console.log('\n🚀 Starting processing...\n');

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

  // Track overall processing start time and session timestamp
  const overallStartTime = Date.now();
  const actualSessionTimestamp =
    sessionTimestamp || formatTimestamp(new Date(overallStartTime), config.timestampFormat);

  // Process all files in batches using the generator
  const allResults: ProcessingResult[] = [];
  for await (const batchResults of processFilesBatchGenerator(
    filesToProcess,
    choices.metadataType,
    choices.batchSize,
    config,
    previousResults,
    overallStartTime,
    actualSessionTimestamp,
  )) {
    allResults.push(...batchResults);
  }

  // Final save of all results (this will create the timestamped files and backups)
  saveResults(allResults, previousResults, config);

  // Calculate skipped files (for incremental updates)
  const skippedFiles = choices.updateType === 'diff' ? totalFilesFound - filesToProcess.length : 0;

  // Generate and display summary
  const summary = generateProcessingSummary(allResults, totalFilesFound, skippedFiles, overallStartTime);
  displayProcessingSummary(summary);
}
