# Ebook CLI Features

A comprehensive command-line tool for managing, processing, and searching large ebook collections with advanced text extraction and indexing capabilities.

## 🔍 Core Search & Indexing

### Full-Text Search Engine

- **Advanced search index** with inverted index for fast lookups
- **Fuzzy search** for approximate matches when exact searches fail
- **BERT-based tokenization** using Xenova/bert-base-uncased model
- **Basic tokenization** with stemming and stopword removal as fallback
- **Configurable search limits** and result ranking

### Index Management

- **Incremental indexing** - only processes new/modified/deleted files
- **Batch processing** for memory-efficient handling of large collections
- **Index compression** options to reduce storage size
- **Metadata tracking** with file change detection
- **Force rebuild** options for complete re-indexing

## 📚 File Format Support

### PDF Processing

- **Multiple extraction engines** with automatic fallback:
  - pdf-parse (primary)
  - pdf2json (fallback)
  - pdfreader (fallback)
- **PDF repair** using QPDF for corrupted files
- **Page limits** for controlling extraction scope
- **Cover image extraction** from first page

### EPUB Processing

- **Dual extraction methods**:
  - epub-parser library (primary)
  - ZIP-based extraction (fallback)
- **EPUB validation** using epubcheck
- **HTML content parsing** with tag removal
- **Chapter-by-chapter processing** to manage memory

## 🛠️ Advanced Processing Options

### Memory Management

- **Configurable memory limits** (default: 4GB, max: 16GB+)
- **File size limits** with skip options for large files
- **Partial content extraction** for oversized documents
- **Memory monitoring** during processing
- **Graceful degradation** when limits are exceeded

### Error Handling & Recovery

- **Automatic file repair** for corrupted PDFs and EPUBs
- **Filename fallback** when content extraction fails
- **Comprehensive error logging** with timestamps
- **Processing statistics** and failure tracking
- **Backup creation** before repair attempts

## 🎯 CLI Commands & Interface

### Main Commands

```bash
# Build search index from directory
ebook build -d /path/to/ebooks

# Update index incrementally
ebook update -v --max-files 200 --max-memory 16GB

# Search the collection
ebook search "query" -l 10 -f

# Extract PDF cover images
pdf-cover filename.pdf -o ./images
```

### Interactive Features

- **Mode selection** (metadata only, with images, update covers, search)
- **Progress tracking** with detailed output
- **Confirmation prompts** with --yes bypass option
- **Verbose logging** for debugging and monitoring

## 📊 Data Management

### Output Formats

- **JSON structured data** with metadata and summaries
- **SQLite database** integration for complex queries
- **Timestamped backups** for version control
- **Processing summaries** with statistics

### Metadata Extraction

- **Title and author** from file metadata
- **Word and token counts** for content analysis
- **File paths and types** for organization
- **Cover images** with automatic extraction
- **Processing timestamps** and version tracking

## ⚙️ Configuration System

### Flexible Setup

```json
{
  "includes": ["H:\\E-Books"],
  "excludes": ["H:\\E-Books\\backup"],
  "tokenization": {
    "mode": "bert",
    "model": "Xenova/bert-base-uncased"
  },
  "filenameReplacements": ["z-library", "libgen"]
}
```

### Customization Options

- **Include/exclude directories** for selective processing
- **Filename cleaning patterns** (removes z-library, libgen markers)
- **Tokenization settings** (BERT vs basic, custom stopwords)
- **Index compression** and storage options
- **Backup and duplicate management** directories

## 🚀 Performance Features

### Batch Processing

- **Configurable batch sizes** for memory optimization
- **Parallel processing** capabilities
- **Progress checkpoints** for long-running operations
- **Resumable operations** after interruption

### Optimization

- **Smart caching** for frequently accessed data
- **Memory usage monitoring** and cleanup
- **File size pre-filtering** to avoid problematic files
- **Efficient index storage** with compression

## 🔧 Advanced Capabilities

### File Management

- **Duplicate detection** and handling
- **Automatic backups** before modifications
- **Directory organization** with configurable paths
- **File type detection** and validation

### Search Enhancement

- **Custom stopword lists** for domain-specific content
- **Token length filtering** (2-50 character range)
- **Field-specific tokenization** (filename, content, metadata)
- **Search result excerpts** with context

### Integration Features

- **Command-line automation** for scripts and workflows
- **JSON output** for integration with other tools
- **SQLite export** for database applications
- **Configurable logging** levels and formats

## 📈 Monitoring & Analytics

### Processing Statistics

- **Files processed, skipped, and failed counts**
- **Processing time and performance metrics**
- **Memory usage tracking**
- **Index size and term frequency analysis**

### Error Reporting

- **Detailed error logs** with file-specific issues
- **Repair attempt tracking**
- **Fallback method usage statistics**
- **Memory and performance warnings**

## 🎨 Extensibility

### Modular Architecture

- **Plugin-ready text extractors** for new formats
- **Configurable tokenization engines**
- **Extensible search backends**
- **Custom metadata extractors**

This ebook-cli tool is designed for researchers, librarians, and anyone managing large digital book collections who need powerful search and organization capabilities.
