#!/usr/bin/env node

import { Command } from 'commander';
import { convertPdfCover } from '../pdfCoverExtractor';

const program = new Command();

program
  .name('pdf-cover')
  .description('Convert PDF cover page to image')
  .version('1.0.0')
  .argument('<file>', 'PDF file name (required)')
  .option('-i, --input <path>', 'input folder containing PDF', 'H:/E-Books')
  .option('-o, --output <path>', 'output folder for images', './images')
  .option('-d, --density <number>', 'image density (DPI)', '150');

program.parse();

const pdfFileName = program.args[0];

if (!pdfFileName) {
  console.error('Error: PDF file name is required');
  console.error('Usage: pdf-cover <file> [options]');
  console.error('Run "pdf-cover --help" for more information');
  process.exit(1);
}

const options = program.opts();
const inputFolder = options.input;
const outputFolder = options.output;
const density = options.density;

// Call the function from CLI
convertPdfCover(inputFolder, outputFolder, pdfFileName, density)
  .then((outputFile: string) => {
    console.log('Page 1 is now converted as image at', outputFile);
  })
  .catch((error: Error) => {
    console.error(error.message);
  });
