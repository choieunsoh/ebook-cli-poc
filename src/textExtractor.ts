/**
 * Text extraction utilities for ebooks (PDF and EPUB).
 */

import AdmZip from 'adm-zip';
import { execSync } from 'child_process';
import Epub from 'epub';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as pdfParse from 'pdf-parse';
import * as pdf2json from 'pdf2json';
import { PdfReader } from 'pdfreader';

export interface TextExtractionResult {
  text: string;
  error?: string;
  wordCount?: number;
  skipped?: boolean;
  reason?: string;
  source?: string; // Indicates where the text was extracted from (e.g., 'pdf-content', 'filename-fallback')
  success?: boolean; // New field to indicate success
}

export interface TextExtractionOptions {
  maxFileSizeMB?: number;
  maxMemoryUsageMB?: number;
  skipLargeFiles?: boolean;
  extractPartialContent?: boolean;
  maxPages?: number;
}

/**
 * Gets memory usage information
 */
function getMemoryUsage(): { used: number; total: number; percentage: number } {
  const memUsage = process.memoryUsage();
  const totalMem = os.totalmem();
  const usedMem = memUsage.heapUsed + memUsage.external;

  return {
    used: Math.round(usedMem / 1024 / 1024), // MB
    total: Math.round(totalMem / 1024 / 1024), // MB
    percentage: Math.round((usedMem / totalMem) * 100),
  };
}

/**
 * Checks if file size is within acceptable limits
 */
function checkFileSize(filePath: string, maxSizeMB: number = 100): { sizeMB: number; isAcceptable: boolean } {
  try {
    const stats = fs.statSync(filePath);
    const sizeMB = stats.size / (1024 * 1024);

    return {
      sizeMB: Math.round(sizeMB * 100) / 100,
      isAcceptable: sizeMB <= maxSizeMB,
    };
  } catch {
    return { sizeMB: 0, isAcceptable: false };
  }
}

/**
 * Cleans up a filename to make it more readable and searchable
 * Exported for testing purposes
 */
export function cleanFilenameForSearch(fileName: string): string {
  // Load config for filename replacements
  const config = loadConfig();

  // Remove file extension if present (handle multiple extensions like .epub, .pdf)
  const nameWithoutExt = fileName.replace(/\.(pdf|epub)$/i, '');

  // Apply custom replacements from config
  let cleaned = nameWithoutExt;
  const replacements = config.filenameReplacements || [];
  for (const pattern of replacements) {
    // Escape special regex characters and create a more flexible pattern
    const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Use word boundaries but also handle patterns with dots/hyphens
    const regex = new RegExp(`\\b${escapedPattern}\\b|${escapedPattern}`, 'gi');
    cleaned = cleaned.replace(regex, '');
  }

  // Convert dots to spaces (but avoid splitting version numbers or abbreviations)
  cleaned = cleaned.replace(/\.+/g, ' ');

  // Convert underscores and hyphens to spaces
  cleaned = cleaned.replace(/[_-]+/g, ' ');

  // Handle camelCase by adding spaces before capital letters (but not at the start)
  cleaned = cleaned.replace(/([a-z])([A-Z])/g, '$1 $2');

  // Handle common ebook patterns
  // Remove author prefixes like "by", "By", "BY"
  cleaned = cleaned.replace(/\b(by|by|BY)\s+/gi, '');

  // Handle edition patterns like "1st Edition", "2nd Edition", etc.
  cleaned = cleaned.replace(/\b(\d+)(st|nd|rd|th)\s+edition?\b/gi, '');

  // Handle year patterns at the end (4-digit years)
  cleaned = cleaned.replace(/\s+\d{4}\b/g, '');

  // Handle volume/chapter patterns
  cleaned = cleaned.replace(/\b(vol|volume|chap|chapter)\.?\s*\d+\b/gi, '');

  // Clean up multiple spaces and trim
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Capitalize first letter of each word for better readability
  cleaned = cleaned.replace(/\b\w/g, (letter) => letter.toUpperCase());

  return cleaned;
}

/**
 * Checks if current memory usage is too high
 */
function isMemoryUsageTooHigh(maxMemoryUsageMB: number): boolean {
  const memoryUsage = getMemoryUsage();
  return memoryUsage.used > maxMemoryUsageMB;
}

/**
 * Extracts text from EPUB using the 'epub' library
 */
async function extractWithEpubParser(
  filePath: string,
  maxMemoryUsageMB: number = 1024,
): Promise<{ text: string; success: boolean; error?: string }> {
  return new Promise((resolve) => {
    try {
      const epub = new Epub(filePath);
      let fullText = '';
      let chapterCount = 0;

      epub.on('end', () => {
        const totalChapters = epub.flow.length;

        if (totalChapters === 0) {
          resolve({ text: '', success: false, error: 'No chapters found in EPUB' });
          return;
        }

        // Process chapters sequentially to avoid memory spikes
        const processChapter = (index: number) => {
          if (index >= totalChapters) {
            // All chapters processed
            resolve({ text: fullText.trim(), success: true });
            return;
          }

          // Check memory before processing each chapter
          if (isMemoryUsageTooHigh(maxMemoryUsageMB)) {
            console.warn(`Memory usage too high during EPUB processing. Stopping at chapter ${index + 1}.`);
            resolve({ text: fullText.trim(), success: true }); // Return what we have
            return;
          }

          const chapter = epub.flow[index];
          const chap = chapter as { id: string };

          epub.getChapter(chap.id, (error: Error | null, text: string) => {
            chapterCount++;

            if (error) {
              console.warn(`Failed to extract chapter ${chap.id}: ${error.message}`);
            } else if (text) {
              // Clean up HTML tags and extra whitespace
              const cleanText = text
                .replace(/<[^>]*>/g, ' ') // Remove HTML tags
                .replace(/\s+/g, ' ') // Normalize whitespace
                .trim();

              // Check if adding this chapter would cause memory issues
              const testText = fullText + cleanText + '\n\n';
              if (Buffer.byteLength(testText, 'utf8') > 50 * 1024 * 1024) {
                // 50MB limit
                console.warn(`EPUB content too large. Stopping at chapter ${chapterCount}.`);
                resolve({ text: fullText.trim(), success: true }); // Return what we have
                return;
              }

              fullText += cleanText + '\n\n';
            }

            // Process next chapter
            processChapter(index + 1);
          });
        };

        // Start processing chapters
        processChapter(0);
      });

      epub.on('error', (error: Error) => {
        resolve({ text: '', success: false, error: `Failed to parse EPUB: ${error.message}` });
      });

      epub.parse();
    } catch (error) {
      resolve({ text: '', success: false, error: `Failed to initialize EPUB parser: ${(error as Error).message}` });
    }
  });
}

/**
 * Extracts text from EPUB by treating it as a ZIP file and parsing HTML content
 */
async function extractWithAdmZip(
  filePath: string,
  maxMemoryUsageMB: number = 1024,
): Promise<{ text: string; success: boolean; error?: string }> {
  try {
    const zip = new AdmZip(filePath);
    const zipEntries = zip.getEntries();

    let fullText = '';
    let htmlFiles: string[] = [];

    // Find HTML/XHTML files in the EPUB
    for (const entry of zipEntries) {
      const fileName = entry.entryName.toLowerCase();
      if (fileName.endsWith('.html') || fileName.endsWith('.xhtml') || fileName.endsWith('.htm')) {
        htmlFiles.push(entry.entryName);
      }
    }

    // Limit to first 50 HTML files to avoid excessive processing
    htmlFiles = htmlFiles.slice(0, 50);

    for (const htmlFile of htmlFiles) {
      try {
        // Check memory before processing each file
        if (isMemoryUsageTooHigh(maxMemoryUsageMB)) {
          console.warn(`Memory usage too high during EPUB ZIP extraction. Stopping at file: ${htmlFile}`);
          break;
        }

        const entry = zip.getEntry(htmlFile);
        if (entry) {
          const content = entry.getData().toString('utf8');

          // Extract text from HTML by removing tags
          const textContent = content
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles
            .replace(/<[^>]+>/g, ' ') // Remove HTML tags
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();

          if (textContent.length > 50) {
            // Only add substantial content
            fullText += textContent + '\n\n';
          }

          // Check if we're approaching memory limits
          if (Buffer.byteLength(fullText, 'utf8') > 25 * 1024 * 1024) {
            // 25MB limit
            console.warn(`EPUB content too large during ZIP extraction. Stopping processing.`);
            break;
          }
        }
      } catch (fileError) {
        console.warn(`Failed to extract content from ${htmlFile}: ${(fileError as Error).message}`);
      }
    }

    const finalText = fullText.trim();
    if (finalText) {
      return { text: finalText, success: true };
    } else {
      return { text: '', success: false, error: 'No readable content found in EPUB ZIP structure' };
    }
  } catch (error) {
    return { text: '', success: false, error: (error as Error).message };
  }
}

/**
 * Extracts text using pdf-parse library
 */
async function extractWithPdfParse(
  dataBuffer: Buffer,
  maxPages: number = 0,
): Promise<{ text: string; success: boolean; error?: string }> {
  try {
    const pdfOptions = maxPages && maxPages > 0 ? { max: maxPages } : { max: 99999 };
    const data = await pdfParse.default(dataBuffer, pdfOptions);
    return { text: data.text.trim(), success: true };
  } catch (error) {
    return { text: '', success: false, error: (error as Error).message };
  }
}

/**
 * Extracts text using pdf2json library
 */
async function extractWithPdf2Json(
  filePath: string,
  maxPages: number = 0,
): Promise<{ text: string; success: boolean; error?: string }> {
  return new Promise((resolve) => {
    try {
      const pdfParser = new pdf2json.default();

      pdfParser.on('pdfParser_dataError', (errData) => {
        const errorMessage =
          typeof errData === 'object' && errData && 'parserError' in errData
            ? (errData.parserError as Error).message
            : 'Unknown pdf2json error';
        resolve({ text: '', success: false, error: errorMessage });
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
        try {
          let fullText = '';
          const pages = pdfData.Pages || [];

          for (let i = 0; i < pages.length; i++) {
            if (maxPages && maxPages > 0 && i >= maxPages) break;

            const page = pages[i];
            const texts = page.Texts || [];

            for (const textItem of texts) {
              if (textItem.R && textItem.R.length > 0) {
                // Decode the text from the R array
                for (const rItem of textItem.R) {
                  if (rItem.T) {
                    // Decode URI component and add spaces
                    const decodedText = decodeURIComponent(rItem.T);
                    fullText += decodedText + ' ';
                  }
                }
              }
            }
            fullText += '\n';
          }

          resolve({ text: fullText.trim(), success: true });
        } catch (parseError) {
          resolve({ text: '', success: false, error: (parseError as Error).message });
        }
      });

      pdfParser.loadPDF(filePath);
    } catch (error) {
      resolve({ text: '', success: false, error: (error as Error).message });
    }
  });
}

/**
 * Extracts text using pdfreader library
 */
async function extractWithPdfReader(
  filePath: string,
  maxPages: number = 0,
): Promise<{ text: string; success: boolean; error?: string }> {
  return new Promise((resolve) => {
    try {
      let fullText = '';
      let currentPage = 0;
      const maxPagesToProcess = maxPages && maxPages > 0 ? maxPages : Infinity;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new PdfReader().parseFileItems(filePath, function (err: any, item: any) {
        if (err) {
          resolve({ text: '', success: false, error: String(err) });
          return;
        }

        if (!item) {
          // End of file
          resolve({ text: fullText.trim(), success: true });
          return;
        }

        if (item.page) {
          currentPage = item.page;
          if (currentPage > maxPagesToProcess) {
            resolve({ text: fullText.trim(), success: true });
            return;
          }
        }

        if (item.text && currentPage <= maxPagesToProcess) {
          fullText += item.text + ' ';
        }
      });
    } catch (error) {
      resolve({ text: '', success: false, error: (error as Error).message });
    }
  });
}

/**
 * Attempts to repair a corrupted PDF file using QPDF
 */
async function repairPDFWithQPDF(
  filePath: string,
): Promise<{ repairedPath: string | null; success: boolean; error?: string }> {
  try {
    // Check if QPDF is available
    try {
      execSync('qpdf --version', { stdio: 'ignore' });
    } catch {
      return { repairedPath: null, success: false, error: 'QPDF command not available' };
    }

    // Load config to get backup directory
    const config = loadConfig();
    const backupDir = config.backupDir || path.dirname(filePath);

    // Ensure backup directory exists
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
      console.log(`Created backup directory: ${backupDir}`);
    }

    // Create paths for backup and repaired files
    const fileName = path.basename(filePath, path.extname(filePath));
    const timestamp = Date.now();
    const backupPath = path.join(backupDir, `${fileName}_backup_${timestamp}.pdf`);
    const repairedPath = path.join(path.dirname(filePath), `${fileName}_repaired_${timestamp}.pdf`);

    console.log(`Creating backup of original PDF: ${backupPath.replace(/\\/g, '/')}`);
    fs.copyFileSync(filePath, backupPath);
    console.log(`Backup created successfully`);

    console.log(`Attempting to repair PDF with QPDF...`);
    console.log(`Repaired file will be created at: ${repairedPath.replace(/\\/g, '/')}`);

    // Use QPDF to repair the PDF
    execSync(`qpdf --linearize "${filePath}" "${repairedPath}"`, {
      stdio: 'pipe', // Suppress output but capture errors
    });

    // Verify the repaired file exists and has content
    if (fs.existsSync(repairedPath)) {
      const stats = fs.statSync(repairedPath);
      if (stats.size > 0) {
        console.log(`PDF repair successful, repaired file: ${repairedPath.replace(/\\/g, '/')}`);
        console.log(`Original file backed up at: ${backupPath.replace(/\\/g, '/')}`);

        // Replace original file with repaired file
        console.log(`Replacing original file with repaired version...`);
        fs.copyFileSync(repairedPath, filePath);
        fs.unlinkSync(repairedPath); // Clean up the temporary repaired file
        console.log(`Original file successfully replaced with repaired version`);

        return { repairedPath: filePath, success: true };
      } else {
        // Clean up empty repaired file
        fs.unlinkSync(repairedPath);
        return { repairedPath: null, success: false, error: 'Repaired file is empty' };
      }
    } else {
      return { repairedPath: null, success: false, error: 'Repaired file was not created' };
    }
  } catch (error) {
    return { repairedPath: null, success: false, error: (error as Error).message };
  }
}

/**
 * Loads configuration from config.json
 */
function loadConfig(): {
  backupDir?: string;
  filenameReplacements?: string[];
  [key: string]: unknown;
} {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    if (!fs.existsSync(configPath)) {
      console.warn('Warning: config.json not found, using default backup location');
      return {};
    }

    const configData = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configData);
    console.log(`Config loaded: backupDir = ${config.backupDir}`);
    return config;
  } catch (error) {
    console.warn('Warning: Could not load config.json:', error);
    return {};
  }
}

/**
 * Attempts to repair a corrupted EPUB file using epubcheck
 */
async function repairEPUBWithEpubCheck(
  filePath: string,
): Promise<{ repairedPath: string | null; success: boolean; error?: string }> {
  try {
    // Load config to get backup directory
    const config = loadConfig();
    const backupDir = config.backupDir || path.dirname(filePath);

    // Ensure backup directory exists
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
      console.log(`Created backup directory: ${backupDir}`);
    }

    // Create backup of original EPUB before any potential repair operations
    const fileName = path.basename(filePath, path.extname(filePath));
    const timestamp = Date.now();
    const backupPath = path.join(backupDir, `${fileName}_backup_${timestamp}.epub`);

    console.log(`Creating backup of original EPUB: ${backupPath.replace(/\\/g, '/')}`);
    fs.copyFileSync(filePath, backupPath);
    console.log(`Backup created successfully`);

    // Use dynamic import to avoid type issues (epub-check has no types)
    // @ts-expect-error - epub-check has no type definitions
    const epubCheckModule = await import('epub-check');
    const epubCheck = epubCheckModule.default as (filePath: string) => Promise<{
      pass: boolean;
      messages: Array<{ message?: string; [key: string]: unknown }>;
    }>;

    // For repair, we'll use epubcheck to validate
    // Note: epubcheck is primarily a validator, not a repair tool like QPDF
    // In a real repair scenario, we would attempt to fix common EPUB issues here
    console.log(`Validating EPUB with epubcheck...`);
    const result = await epubCheck(filePath);

    if (result.pass) {
      console.log(`EPUB validation passed, no repair needed: ${filePath}`);
      console.log(`Backup file created at: ${backupPath.replace(/\\/g, '/')}`);

      // Since no repair was needed, we could optionally remove the backup
      // But let's keep it for safety - user can clean up manually if desired
      return { repairedPath: filePath, success: true };
    } else {
      console.log(`EPUB validation failed with ${result.messages.length} issues`);

      // Log the specific validation errors
      if (result.messages && result.messages.length > 0) {
        console.log('Validation errors:');
        result.messages.slice(0, 5).forEach((msg, index) => {
          const message = typeof msg === 'string' ? msg : msg.message || 'Unknown error';
          console.log(`  ${index + 1}. ${message}`);
        });
        if (result.messages.length > 5) {
          console.log(`  ... and ${result.messages.length - 5} more issues`);
        }
      }

      // For now, we can't automatically repair EPUBs like PDFs
      // In a more advanced implementation, we could try to fix common issues:
      // - Fix malformed XML/HTML
      // - Repair missing or corrupted files in the ZIP structure
      // - Fix OPF/manifest issues
      // - Repair navigation document problems

      console.log(`EPUB repair not implemented yet. Original file preserved.`);
      console.log(`Backup available at: ${backupPath.replace(/\\/g, '/')}`);

      return {
        repairedPath: null,
        success: false,
        error: `EPUB validation failed: ${result.messages.length} issues found. Backup created at ${backupPath}`,
      };
    }
  } catch (error) {
    console.error(`Error during EPUB repair attempt: ${(error as Error).message}`);

    // Even if validation failed, the backup was created successfully
    // The original file remains intact
    return {
      repairedPath: null,
      success: false,
      error: `EPUB repair failed: ${(error as Error).message}. Original file preserved.`,
    };
  }
}

/**
 * Extracts text content from a PDF file with memory management
 */
export async function extractTextFromPDF(
  filePath: string,
  options: TextExtractionOptions = {},
): Promise<TextExtractionResult> {
  const {
    maxFileSizeMB = 100,
    maxMemoryUsageMB = 1024,
    skipLargeFiles = true,
    extractPartialContent = false,
    maxPages = 100,
  } = options;

  try {
    // Check file size first
    const fileSizeCheck = checkFileSize(filePath, maxFileSizeMB);
    if (!fileSizeCheck.isAcceptable) {
      if (skipLargeFiles) {
        return {
          text: '',
          skipped: true,
          reason: `File too large (${fileSizeCheck.sizeMB}MB > ${maxFileSizeMB}MB limit)`,
        };
      } else {
        console.warn(`Warning: Processing large file (${fileSizeCheck.sizeMB}MB). This may cause memory issues.`);
      }
    }

    // Check memory usage before processing
    if (isMemoryUsageTooHigh(maxMemoryUsageMB)) {
      return {
        text: '',
        error: `Memory usage too high (${getMemoryUsage().used}MB). Skipping file to prevent crashes.`,
      };
    }

    // Set up memory monitoring
    const initialMemory = getMemoryUsage();

    try {
      const dataBuffer = fs.readFileSync(filePath);

      // Check memory after loading file
      if (isMemoryUsageTooHigh(maxMemoryUsageMB)) {
        return {
          text: '',
          error: `Memory usage too high after loading file (${getMemoryUsage().used}MB). File may be too large.`,
        };
      }

      // Try multiple PDF parsing libraries in sequence as fallbacks
      const extractors = [
        { name: 'pdf-parse', func: () => extractWithPdfParse(dataBuffer, maxPages) },
        { name: 'pdf2json', func: () => extractWithPdf2Json(filePath, maxPages) },
        { name: 'pdfreader', func: () => extractWithPdfReader(filePath, maxPages) },
      ];

      let lastError = '';
      for (const extractor of extractors) {
        try {
          console.log(`Trying PDF extraction with ${extractor.name}...`);
          const result = await extractor.func();

          if (result.success && result.text.trim()) {
            let text = result.text;

            // If partial extraction is enabled and we hit page limit, truncate
            // Only apply page limit if maxPages > 0
            if (extractPartialContent && maxPages && maxPages > 0) {
              // For fallback libraries, we can't easily check total pages,
              // so we'll just use the extracted text as-is
              console.warn(
                `Warning: Extracted content with ${extractor.name}, page limit may not be strictly enforced`,
              );
            }

            const wordCount = text.split(/\s+/).filter((word: string) => word.length > 0).length;

            // Check final memory usage
            const finalMemory = getMemoryUsage();
            if (finalMemory.used > initialMemory.used + 500) {
              // More than 500MB increase
              console.warn(
                `Warning: Memory usage increased significantly during PDF processing (${initialMemory.used}MB -> ${finalMemory.used}MB)`,
              );
            }

            console.log(`Successfully extracted text using ${extractor.name} (${wordCount} words)`);
            return {
              text,
              wordCount,
              source: 'pdf-content',
              success: true,
            };
          } else {
            lastError = result.error || `No text extracted with ${extractor.name}`;
            console.warn(`Failed with ${extractor.name}: ${lastError}`);
          }
        } catch (extractorError) {
          lastError = (extractorError as Error).message;
          console.warn(`Error with ${extractor.name}: ${lastError}`);
        }
      }

      // All extractors failed
      console.log(`All PDF extraction methods failed. Last error: ${lastError}`);
      console.log(`Attempting PDF repair and retry...`);

      // Try to repair the PDF and retry with pdf-parse
      const repairResult = await repairPDFWithQPDF(filePath);
      if (repairResult.success && repairResult.repairedPath) {
        try {
          console.log(`Retrying extraction with repaired PDF using pdf-parse...`);
          const repairedBuffer = fs.readFileSync(repairResult.repairedPath);

          // Clean up the temporary repaired file after reading
          fs.unlinkSync(repairResult.repairedPath);

          const retryResult = await extractWithPdfParse(repairedBuffer, maxPages);
          if (retryResult.success && retryResult.text.trim()) {
            const wordCount = retryResult.text.split(/\s+/).filter((word: string) => word.length > 0).length;

            // Check final memory usage
            const finalMemory = getMemoryUsage();
            if (finalMemory.used > initialMemory.used + 500) {
              console.warn(
                `Warning: Memory usage increased significantly during PDF processing (${initialMemory.used}MB -> ${finalMemory.used}MB)`,
              );
            }

            console.log(`Successfully extracted text from repaired PDF (${wordCount} words)`);
            return {
              text: retryResult.text,
              wordCount,
              source: 'pdf-content',
              success: true,
            };
          } else {
            console.warn(`Repair attempt failed: ${retryResult.error}`);
          }
        } catch (repairRetryError) {
          console.warn(`Error during repair retry: ${(repairRetryError as Error).message}`);
        }
      } else {
        console.warn(`PDF repair failed: ${repairResult.error}`);
      }

      // If all extraction methods and repair failed, use filename as fallback content
      const fileName = path.basename(filePath, path.extname(filePath));
      const cleanedFileName = cleanFilenameForSearch(fileName);
      console.log(`Using cleaned filename as fallback content: ${cleanedFileName}`);

      return {
        text: cleanedFileName,
        wordCount: cleanedFileName.split(/\s+/).filter((word: string) => word.length > 0).length,
        error: `All PDF extraction methods failed. Repair attempt also failed. Using cleaned filename as content. Last error: ${lastError}`,
        source: 'filename-fallback',
        success: true, // Changed to true - fallback extraction is still successful
      };
    } catch (pdfError) {
      // Handle all PDF parsing errors gracefully, not just memory-related ones
      const errorMessage = (pdfError as Error).message;
      if (errorMessage.includes('heap') || errorMessage.includes('memory')) {
        return {
          text: '',
          error: `Memory error during PDF processing: ${errorMessage}`,
          skipped: true,
        };
      } else {
        // Handle other PDF parsing errors (like XRef inconsistencies, corrupted files, etc.)
        return {
          text: '',
          error: `PDF parsing error: ${errorMessage}`,
          skipped: true,
        };
      }
    }
  } catch (error) {
    return {
      text: '',
      error: `Failed to extract text from PDF: ${(error as Error).message}`,
    };
  }
}

/**
 * Extracts text content from an EPUB file with memory management and fallback
 */
export async function extractTextFromEPUB(
  filePath: string,
  options: TextExtractionOptions = {},
): Promise<TextExtractionResult> {
  const { maxMemoryUsageMB = 1024, maxFileSizeMB = 100, skipLargeFiles = true } = options;

  try {
    // Check file size first
    const fileSizeCheck = checkFileSize(filePath, maxFileSizeMB);
    if (!fileSizeCheck.isAcceptable && skipLargeFiles) {
      return {
        text: '',
        skipped: true,
        reason: `EPUB file too large (${fileSizeCheck.sizeMB}MB > ${maxFileSizeMB}MB limit)`,
      };
    }

    // Check memory usage
    if (isMemoryUsageTooHigh(maxMemoryUsageMB)) {
      return {
        text: '',
        error: `Memory usage too high (${getMemoryUsage().used}MB). Skipping EPUB to prevent crashes.`,
      };
    }

    // Try multiple EPUB parsing approaches as fallbacks
    const extractors = [
      { name: 'epub-parser', func: () => extractWithEpubParser(filePath, maxMemoryUsageMB) },
      { name: 'adm-zip', func: () => extractWithAdmZip(filePath, maxMemoryUsageMB) },
    ];

    let lastError = '';
    for (const extractor of extractors) {
      try {
        console.log(`Trying EPUB extraction with ${extractor.name}...`);
        const result = await extractor.func();

        if (result.success && result.text.trim()) {
          const wordCount = result.text.split(/\s+/).filter((word: string) => word.length > 0).length;
          console.log(`Successfully extracted text from EPUB using ${extractor.name} (${wordCount} words)`);

          return {
            text: result.text,
            wordCount,
            source: 'epub-content',
            success: true,
          };
        } else {
          lastError = result.error || `No text extracted with ${extractor.name}`;
          console.warn(`Failed with ${extractor.name}: ${lastError}`);
        }
      } catch (extractorError) {
        lastError = (extractorError as Error).message;
        console.warn(`Error with ${extractor.name}: ${lastError}`);
      }
    }

    // All EPUB extractors failed
    console.log(`All EPUB extraction methods failed. Last error: ${lastError}`);
    console.log(`Attempting EPUB repair and retry...`);

    // Try to repair the EPUB and retry with epub-parser
    const repairResult = await repairEPUBWithEpubCheck(filePath);
    if (repairResult.success && repairResult.repairedPath) {
      try {
        console.log(`Retrying extraction with repaired EPUB using epub-parser...`);
        const retryResult = await extractWithEpubParser(repairResult.repairedPath, maxMemoryUsageMB);
        if (retryResult.success && retryResult.text.trim()) {
          const wordCount = retryResult.text.split(/\s+/).filter((word: string) => word.length > 0).length;
          console.log(`Successfully extracted text from repaired EPUB (${wordCount} words)`);

          return {
            text: retryResult.text,
            wordCount,
            source: 'epub-content',
            success: true,
          };
        } else {
          console.warn(`Repair attempt failed: ${retryResult.error}`);
        }
      } catch (repairRetryError) {
        console.warn(`Error during repair retry: ${(repairRetryError as Error).message}`);
      }
    } else {
      console.warn(`EPUB repair failed: ${repairResult.error}`);
    }

    // All EPUB extractors and repair failed, fall back to filename
    console.log(`All EPUB extraction methods and repair failed. Last error: ${lastError}`);
    console.log(`Falling back to filename extraction for EPUB...`);

    const fileName = path.basename(filePath, path.extname(filePath));
    const cleanedFileName = cleanFilenameForSearch(fileName);
    console.log(`Using cleaned filename as fallback content: ${cleanedFileName}`);

    return {
      text: cleanedFileName,
      wordCount: cleanedFileName.split(/\s+/).filter((word: string) => word.length > 0).length,
      error: `All EPUB extraction methods failed. Using cleaned filename as content. Last error: ${lastError}`,
      source: 'filename-fallback',
      success: true, // Changed to true - fallback extraction is still successful
    };
  } catch (error) {
    return {
      text: '',
      error: `Failed to extract text from EPUB: ${(error as Error).message}`,
    };
  }
}

/**
 * Extracts text content from any supported ebook file
 */
export async function extractTextFromFile(
  filePath: string,
  options: TextExtractionOptions = {},
): Promise<TextExtractionResult> {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.pdf':
      return extractTextFromPDF(filePath, options);
    case '.epub':
      return extractTextFromEPUB(filePath, options);
    default:
      return {
        text: '',
        error: `Unsupported file type: ${ext}`,
      };
  }
}
