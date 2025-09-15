/**
 * Utility functions for the ebook CLI tool.
 */

/**
 * Maps quick action selections to actual update types.
 */
export function mapQuickActionToUpdateType(
  quickAction: 'quick-process' | 'quick-search' | 'quick-summarize',
):
  | 'diff'
  | 'full'
  | 'append'
  | 'summarize'
  | 'search'
  | 'import-sqlite'
  | 'tokenize'
  | 'configure-tokenization'
  | 'run-sql'
  | 'rank-tokens' {
  switch (quickAction) {
    case 'quick-process':
      return 'diff';
    case 'quick-search':
      return 'search';
    case 'quick-summarize':
      return 'summarize';
    default:
      throw new Error(`Unknown quick action: ${quickAction}`);
  }
}

/**
 * Gets the display name for the update type.
 */
export function getUpdateTypeDisplayName(updateType: string): string {
  const displayNames: Record<string, string> = {
    append: 'Append Batch Results',
    summarize: '📊 Show Summary',
    search: '🔍 Search Collection',
    'import-sqlite': 'Import to SQLite Database',
    tokenize: 'Tokenize Titles/Filenames',
    'configure-tokenization': 'Configure Tokenization Settings',
    'run-sql': 'Run SQL Query',
    'rank-tokens': 'Rank Token Occurrences',
    diff: '🔄 Process Ebooks (Incremental)',
    full: 'Full Scan (all files)',
  };

  return displayNames[updateType] || 'Unknown Operation';
}

/**
 * Gets the display name for the file type.
 */
export function getFileTypeDisplayName(fileType: string): string {
  const displayNames: Record<string, string> = {
    both: 'All ebooks (PDF + EPUB)',
    pdf: 'PDF files only',
    epub: 'EPUB files only',
  };

  return displayNames[fileType] || 'Unknown File Type';
}

/**
 * Gets the display name for the metadata type.
 */
export function getMetadataTypeDisplayName(metadataType: string): string {
  const displayNames: Record<string, string> = {
    'file-metadata': 'File metadata only',
    metadata: 'Ebook metadata only',
    'metadata+cover': 'Ebook metadata + Cover Images',
  };

  return displayNames[metadataType] || 'Unknown Metadata Type';
}
