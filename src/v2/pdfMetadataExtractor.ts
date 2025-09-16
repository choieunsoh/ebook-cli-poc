/**
 * PDF Metadata Extractor with Fallback
 * Extracts metadata from PDF files using pdf-parse as primary, with pdf2json as fallback.
 */

import * as fs from 'fs';
import pdf from 'pdf-parse';
import PDFParser from 'pdf2json';
import type { PDFMetadata } from './types';

/**
 * Extracts metadata from a PDF file using pdf-parse first, with pdf2json as fallback.
 * @param filePath - Path to the PDF file
 * @returns Promise resolving to extracted metadata or null if extraction fails
 */
export async function extractPDFMetadata(filePath: string): Promise<PDFMetadata | null> {
  try {
    // Try pdf-parse first (fast and simple)
    const dataBuffer = fs.readFileSync(filePath);

    // Add timeout wrapper around pdf-parse to prevent hanging
    const pdfParsePromise = pdf(dataBuffer);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('PDF parsing timeout')), 30000),
    );

    const pdfData = await Promise.race([pdfParsePromise, timeoutPromise]);

    const metadata: PDFMetadata = {
      title: pdfData.info?.Title,
      author: pdfData.info?.Author,
      creator: pdfData.info?.Creator,
      producer: pdfData.info?.Producer,
      subject: pdfData.info?.Subject,
      creationDate: pdfData.info?.CreationDate,
      modDate: pdfData.info?.ModDate,
      pages: pdfData.numpages,
      keywords: pdfData.info?.Keywords,
      formatVersion: pdfData.info?.PDFFormatVersion,
      isAcroFormPresent: pdfData.info?.IsAcroFormPresent,
      isXFAPresent: pdfData.info?.IsXFAPresent,
    };

    // Check if essential metadata is present; if not, try fallback
    const hasBasicMetadata = metadata.title || metadata.author || metadata.creator;
    if (!hasBasicMetadata) {
      console.warn(`pdf-parse extracted incomplete metadata for ${filePath}, trying fallback...`);
      return await extractWithPdf2Json(filePath);
    }

    return metadata;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`pdf-parse failed for ${filePath}: ${errorMessage}, trying fallback...`);

    // Try fallback extraction
    try {
      return await extractWithPdf2Json(filePath);
    } catch (fallbackError) {
      const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : 'Unknown fallback error';
      console.error(`Both pdf-parse and pdf2json failed for ${filePath}: ${fallbackErrorMessage}`);
      return null;
    }
  }
}

/**
 * Fallback extraction using pdf2json for more robust parsing.
 * @param filePath - Path to the PDF file
 * @returns Promise resolving to extracted metadata or null if extraction fails
 */
async function extractWithPdf2Json(filePath: string): Promise<PDFMetadata | null> {
  return new Promise((resolve) => {
    try {
      const pdfParser = new PDFParser();

      // Add timeout for pdf2json as well
      const timeout = setTimeout(() => {
        console.warn(`pdf2json timeout for ${filePath}`);
        pdfParser.destroy();
        resolve(null);
      }, 30000);

      pdfParser.on('pdfParser_dataReady', (pdfData) => {
        clearTimeout(timeout);
        try {
          const meta = pdfData.Meta;
          const metadata: PDFMetadata = {
            title: meta?.Title || meta?.['dc:title'],
            author: meta?.Author || meta?.['dc:creator'],
            creator: meta?.Creator,
            producer: meta?.Producer,
            subject: meta?.Subject || meta?.['dc:description'],
            creationDate: meta?.CreationDate,
            modDate: meta?.ModDate,
            pages: pdfData.Pages?.length,
            keywords: meta?.Keywords,
            formatVersion: meta?.PDFFormatVersion,
            isAcroFormPresent: meta?.IsAcroFormPresent,
            isXFAPresent: meta?.IsXFAPresent,
          };
          resolve(metadata);
        } catch (parseError) {
          console.error(`Error parsing pdf2json data for ${filePath}:`, parseError);
          resolve(null);
        }
      });

      pdfParser.on('pdfParser_dataError', (err) => {
        clearTimeout(timeout);
        const errorMessage = 'parserError' in err ? err.parserError?.message : (err as Error).message;
        console.error(`pdf2json failed for ${filePath}:`, errorMessage);
        resolve(null);
      });

      // Handle file loading errors
      try {
        pdfParser.loadPDF(filePath);
      } catch (loadError) {
        clearTimeout(timeout);
        console.error(`Error loading PDF file ${filePath} with pdf2json:`, loadError);
        resolve(null);
      }
    } catch (setupError) {
      console.error(`Error setting up pdf2json for ${filePath}:`, setupError);
      resolve(null);
    }
  });
}

/**
 * Utility function to check if metadata extraction was successful.
 * @param metadata - The extracted metadata
 * @returns True if metadata has at least basic fields
 */
export function isMetadataComplete(metadata: PDFMetadata | null): boolean {
  if (!metadata) return false;
  return !!(metadata.title || metadata.author || metadata.creator);
}
