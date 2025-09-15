/**
 * Module for searching data in data.json
 */

import * as fs from 'fs';
import inquirer from 'inquirer';
import { ProcessingResult } from './types';

/**
 * Searches for ebooks by title or filename containing the search term.
 * Continues prompting for new search terms until term is empty.
 * @param dataFilePath - Path to the data.json file
 * @param initialSearchTerm - The initial term to search for
 */
export async function searchByTitle(dataFilePath: string, initialSearchTerm: string): Promise<void> {
  let continueSearching = true;
  let currentSearchTerm = initialSearchTerm;

  // If no initial search term, prompt for the first one
  if (!currentSearchTerm.trim()) {
    const searchAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'searchTerm',
        message: 'Enter a search term (will search in title and filename, empty to quit):',
        validate: () => {
          return true; // Allow empty input to quit
        },
      },
    ]);
    currentSearchTerm = searchAnswer.searchTerm.trim();

    // Exit if term is empty
    if (!currentSearchTerm) {
      console.log('👋 Search session ended. Returning to main menu...');
      return;
    }
  }

  while (continueSearching) {
    if (fs.existsSync(dataFilePath)) {
      const data = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8')) as ProcessingResult[];
      const lowerSearchTerm = currentSearchTerm.toLowerCase();

      const matches = data.filter((d) => {
        const title = (d.metadata as { title?: string })?.title?.toLowerCase() || '';
        const file = d.file.toLowerCase();
        return title.includes(lowerSearchTerm) || file.includes(lowerSearchTerm);
      });

      console.log('\n🔍 Search Results');
      console.log('=================');
      console.log(`Search Term: "${currentSearchTerm}"`);
      console.log(`Total matches: ${matches.length}`);

      if (matches.length > 0) {
        console.log('\n📋 Matching Files:');
        console.log('==================');
        matches.forEach((d, index) => {
          const title = (d.metadata as { title?: string })?.title || 'No title';
          const author = (d.metadata as { author?: string })?.author || 'Unknown author';
          console.log(`${index + 1}. ${d.file} (${d.type})`);
          console.log(`   Title: ${title}`);
          console.log(`   Author: ${author}`);
          console.log(`   Path: ${d.fileMetadata.path}`);
          console.log('');
        });
      } else {
        console.log('No matches found.');
      }
    } else {
      console.log('❌ data.json not found.');
      break;
    }

    // Prompt for new search term
    const searchAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'searchTerm',
        message: 'Enter a new search term (empty to quit):',
        validate: () => {
          return true; // Allow empty input to quit
        },
      },
    ]);
    currentSearchTerm = searchAnswer.searchTerm.trim();

    // Exit if term is empty
    if (!currentSearchTerm) {
      continueSearching = false;
      console.log('👋 Search session ended. Returning to main menu...');
    }
  }
}
