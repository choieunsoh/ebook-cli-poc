// append all files in ./output/batches-2025-09-14_18-56-37 to ./output/data.json
import * as fs from 'fs';
import * as path from 'path';

/**
 * Appends batch results from a specified batches directory to a data file, ensuring uniqueness.
 * @param batchesDir - The name of the batches directory (e.g., 'batches-2025-09-15_00-26-02')
 * @param dataFilePath - The path to the data file (e.g., './output/data.json')
 */
export function appendBatchResults(batchesDir: string, dataFilePath: string): void {
  const startTime = Date.now();
  const outputDir = path.dirname(dataFilePath);
  const batchesPath = path.join(outputDir, batchesDir);

  const batchFiles = fs.readdirSync(batchesPath).filter((file) => file.endsWith('.json'));
  const dataMap = new Map<string, object>();

  // Load existing data into map
  let existingEntries = 0;
  if (fs.existsSync(dataFilePath)) {
    const existingData = fs.readFileSync(dataFilePath, 'utf-8');
    const existingArray: object[] = JSON.parse(existingData);
    existingEntries = existingArray.length;
    for (const item of existingArray) {
      const key = (item as { file?: string; path?: string }).file || (item as { file?: string; path?: string }).path;
      if (key) {
        dataMap.set(key, item);
      }
    }
  }

  // Add new data from batches
  let totalBatchEntries = 0;
  let newEntries = 0;
  for (const file of batchFiles) {
    const filePath = path.join(batchesPath, file);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const jsonData: object[] = JSON.parse(fileContent);
    totalBatchEntries += jsonData.length;
    for (const item of jsonData) {
      const key = (item as { file?: string; path?: string }).file || (item as { file?: string; path?: string }).path;
      if (key && !dataMap.has(key)) {
        newEntries++;
      }
      if (key) {
        dataMap.set(key, item);
      }
    }
  }

  const allData = Array.from(dataMap.values());

  fs.writeFileSync(dataFilePath, JSON.stringify(allData, null, 2), 'utf-8');
  console.log(`Appended ${allData.length} entries to ${dataFilePath}`);

  // Processing Summary
  console.log('\n📊 Append Summary');
  console.log('===================');
  console.log(`📁 Batch files processed: ${batchFiles.length}`);
  console.log(`📄 Total entries from batches: ${totalBatchEntries}`);
  console.log(`📈 New entries added: ${newEntries}`);
  console.log(`🔄 Duplicates/overwrites: ${totalBatchEntries - newEntries}`);
  console.log(`💾 Existing entries: ${existingEntries}`);
  console.log(`🎯 Final total entries: ${allData.length}`);
  console.log(`⏱️  Processing time: ${Date.now() - startTime}ms`);
}
