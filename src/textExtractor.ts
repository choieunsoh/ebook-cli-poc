/**
 * Text extraction utilities for ebooks (PDF and EPUB).
 */

import Epub from 'epub';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as pdfParse from 'pdf-parse';

export interface TextExtractionResult {
  text: string;
  error?: string;
  wordCount?: number;
  skipped?: boolean;
  reason?: string;
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
 * Checks if current memory usage is too high
 */
function isMemoryUsageTooHigh(maxMemoryMB: number = 1024): boolean {
  const memUsage = getMemoryUsage();
  return memUsage.used > maxMemoryMB;
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

      // Only limit pages if maxPages is specified and > 0
      const pdfOptions = maxPages && maxPages > 0 ? { max: maxPages } : { max: 99999 };

      const data = await pdfParse.default(dataBuffer, pdfOptions);

      let text = data.text.trim();

      // If partial extraction is enabled and we hit page limit, truncate
      // Only apply page limit if maxPages > 0
      if (extractPartialContent && maxPages && maxPages > 0 && data.numpages > maxPages) {
        const pages = text.split('\n\n');
        text = pages.slice(0, maxPages).join('\n\n');
        console.warn(`Warning: Extracted only first ${maxPages} pages of ${data.numpages} total pages`);
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

      return {
        text,
        wordCount,
      };
    } catch (pdfError) {
      // If it's a memory-related error, handle gracefully
      if ((pdfError as Error).message.includes('heap') || (pdfError as Error).message.includes('memory')) {
        return {
          text: '',
          error: `Memory error during PDF processing: ${(pdfError as Error).message}`,
          skipped: true,
        };
      }
      throw pdfError;
    }
  } catch (error) {
    return {
      text: '',
      error: `Failed to extract text from PDF: ${(error as Error).message}`,
    };
  }
}

/**
 * Extracts text content from an EPUB file with memory management
 */
export async function extractTextFromEPUB(
  filePath: string,
  options: TextExtractionOptions = {},
): Promise<TextExtractionResult> {
  const { maxMemoryUsageMB = 1024, maxFileSizeMB = 100, skipLargeFiles = true } = options;

  return new Promise((resolve) => {
    try {
      // Check file size first
      const fileSizeCheck = checkFileSize(filePath, maxFileSizeMB);
      if (!fileSizeCheck.isAcceptable && skipLargeFiles) {
        resolve({
          text: '',
          skipped: true,
          reason: `EPUB file too large (${fileSizeCheck.sizeMB}MB > ${maxFileSizeMB}MB limit)`,
        });
        return;
      }

      // Check memory usage
      if (isMemoryUsageTooHigh(maxMemoryUsageMB)) {
        resolve({
          text: '',
          error: `Memory usage too high (${getMemoryUsage().used}MB). Skipping EPUB to prevent crashes.`,
        });
        return;
      }

      const epub = new Epub(filePath);
      let fullText = '';
      let chapterCount = 0;

      epub.on('end', () => {
        const totalChapters = epub.flow.length;

        if (totalChapters === 0) {
          resolve({
            text: '',
            error: 'No chapters found in EPUB',
          });
          return;
        }

        // Process chapters sequentially to avoid memory spikes
        const processChapter = (index: number) => {
          if (index >= totalChapters) {
            // All chapters processed
            const wordCount = fullText.split(/\s+/).filter((word: string) => word.length > 0).length;
            resolve({
              text: fullText.trim(),
              wordCount,
            });
            return;
          }

          // Check memory before processing each chapter
          if (isMemoryUsageTooHigh(maxMemoryUsageMB)) {
            console.warn(`Memory usage too high during EPUB processing. Stopping at chapter ${index + 1}.`);
            const wordCount = fullText.split(/\s+/).filter((word: string) => word.length > 0).length;
            resolve({
              text: fullText.trim(),
              wordCount,
              error: `Processing stopped at chapter ${index + 1} due to high memory usage`,
            });
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
                const wordCount = fullText.split(/\s+/).filter((word: string) => word.length > 0).length;
                resolve({
                  text: fullText.trim(),
                  wordCount,
                  error: `Content too large. Processing stopped at chapter ${chapterCount}.`,
                });
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
        resolve({
          text: '',
          error: `Failed to parse EPUB: ${error.message}`,
        });
      });

      epub.parse();
    } catch (error) {
      resolve({
        text: '',
        error: `Failed to initialize EPUB parser: ${(error as Error).message}`,
      });
    }
  });
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
