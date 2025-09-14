// append all files in ./output/batches-2025-09-14_18-56-37 to ./output/data.json
import * as fs from 'fs';
import * as path from 'path';

const outputDir = path.join(process.cwd(), 'output');
const batchesDir = 'batches-2025-09-14_21-40-04';
const batchesPath = path.join(outputDir, batchesDir);
const dataFilePath = path.join(outputDir, 'data.json');

const batchFiles = fs.readdirSync(batchesPath).filter((file) => file.endsWith('.json'));
const dataMap = new Map<string, object>();

// Load existing data into map
if (fs.existsSync(dataFilePath)) {
  const existingData = fs.readFileSync(dataFilePath, 'utf-8');
  const existingArray: object[] = JSON.parse(existingData);
  for (const item of existingArray) {
    const key = (item as { file?: string; path?: string }).file || (item as { file?: string; path?: string }).path;
    if (key) {
      dataMap.set(key, item);
    }
  }
}

// Add new data from batches
for (const file of batchFiles) {
  const filePath = path.join(batchesPath, file);
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const jsonData: object[] = JSON.parse(fileContent);
  for (const item of jsonData) {
    const key = (item as { file?: string; path?: string }).file || (item as { file?: string; path?: string }).path;
    if (key) {
      dataMap.set(key, item);
    }
  }
}

const allData = Array.from(dataMap.values());

fs.writeFileSync(dataFilePath, JSON.stringify(allData, null, 2), 'utf-8');
console.log(`Appended ${allData.length} entries to ${dataFilePath}`);
