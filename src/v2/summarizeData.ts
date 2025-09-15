/**
 * Module for summarizing data from data.json
 */

import * as fs from 'fs';
import { ProcessingResult } from './types';

/**
 * Summarizes the data in data.json and prints the summary.
 * @param dataFilePath - Path to the data.json file
 * @param displayWithoutMetadata - Whether to display the list of files without metadata
 */
export function summarizeData(dataFilePath: string, displayWithoutMetadata: boolean = false): void {
  if (fs.existsSync(dataFilePath)) {
    const data = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8')) as ProcessingResult[];
    const totalEntries = data.length;
    const pdfFiles = data.filter((d) => d.type === 'pdf').length;
    const epubFiles = data.filter((d) => d.type === 'epub').length;
    const withMetadata = data.filter((d) => d.metadata).length;
    const withoutMetadata = totalEntries - withMetadata;
    const totalSize = data.reduce((sum, d) => sum + d.fileMetadata.size, 0);

    console.log('\n📊 Data Summary');
    console.log('===============');
    console.log(`📁 Total entries: ${totalEntries.toLocaleString()}`);
    console.log(`📄 PDF files: ${pdfFiles.toLocaleString()}`);
    console.log(`📖 EPUB files: ${epubFiles.toLocaleString()}`);
    console.log(`🎯 With metadata: ${withMetadata.toLocaleString()}`);
    console.log(`❌ Without metadata: ${withoutMetadata.toLocaleString()}`);
    console.log(`💾 Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

    if (displayWithoutMetadata && withoutMetadata > 0) {
      console.log('\n📋 Files without metadata:');
      console.log('==========================');
      const filesWithoutMetadata = data.filter((d) => !d.metadata);
      filesWithoutMetadata.forEach((d, index) => {
        console.log(`${index + 1}. ${d.file} (${d.type}) - ${d.fileMetadata.path}`);
      });
    }
  } else {
    console.log('❌ data.json not found.');
  }
}
