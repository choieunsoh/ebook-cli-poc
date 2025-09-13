import { exec } from 'child_process';
import * as fs from 'fs';

// Function to convert PDF cover to image
export async function convertPdfCover(
  inputFolder: string,
  outputFolder: string,
  pdfFileName: string,
  density: number,
): Promise<string> {
  const baseName = pdfFileName.replace('.pdf', '');
  const saveOptions = {
    density,
    saveFilename: baseName,
    savePath: outputFolder,
    format: 'webp',
  };

  // Ensure the output directory exists
  if (!fs.existsSync(saveOptions.savePath)) {
    fs.mkdirSync(saveOptions.savePath, { recursive: true });
  }

  const outputFile = `${saveOptions.savePath}/${saveOptions.saveFilename}.${saveOptions.format}`;

  // Docker command to convert PDF page to image with separate mounts for input and output
  const dockerCommand = `docker run --rm \
    -v "${inputFolder}:/input" \
    -v "${outputFolder}:/output" \
    minidocks/imagemagick \
    magick -density ${saveOptions.density} "/input/${pdfFileName}"[0] "/output/${saveOptions.saveFilename}.${saveOptions.format}"`;

  return new Promise((resolve, reject) => {
    exec(dockerCommand, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Error converting PDF page to image: ${error.message}`));
        return;
      }
      if (stderr) {
        console.warn('Stderr:', stderr);
      }
      resolve(outputFile);
    });
  });
}
