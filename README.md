# Ebook CLI

A powerful command-line tool for managing, processing, and searching large ebook collections with advanced text extraction and full-text search capabilities.

## 🚀 Quick Start

```bash
# Install dependencies
yarn install

# Build the project
yarn build

# Create your configuration
cp config.json.example config.json
# Edit config.json with your ebook directories

# Build search index from your ebook collection
ebook update -v

# Search your collection
ebook search "machine learning" -l 10

# View index statistics
ebook summary -v
```

## 📖 Overview

Ebook CLI is designed for researchers, librarians, and anyone managing large digital book collections. It provides:

- **Full-text search** across PDF and EPUB files
- **Intelligent text extraction** with multiple fallback methods
- **Memory-efficient processing** for large collections
- **Incremental indexing** for fast updates
- **Advanced tokenization** with BERT support
- **Automatic file repair** for corrupted documents

## 🛠️ Installation

### Prerequisites

- Node.js 24.7.0+ (managed by Volta)
- TypeScript
- Optional: QPDF for PDF repair functionality

### Setup

1. Clone the repository:

```bash
git clone <repository-url>
cd ebook-cli
```

2. Install dependencies:

```bash
yarn install
```

3. Build the project:

```bash
yarn build
```

4. Configure your ebook directories:

```bash
cp config.json.example config.json
```

Edit `config.json` to specify your ebook directories:

```json
{
  "includes": ["H:\\E-Books"],
  "excludes": ["H:\\E-Books\\backup", "H:\\E-Books\\duplicates"],
  "outputDir": "output",
  "dataFile": "data.json"
}
```

## 📚 Usage

### Building Your Search Index

First, build a search index from your ebook collection:

```bash
# Full index build
ebook update -v --max-files 1000

# Build with custom memory limits
ebook update -v --max-memory 8GB --max-file-size 200

# Force complete rebuild
ebook update -v --force
```

### Searching Your Collection

Search for books using full-text search:

```bash
# Basic search
ebook search "artificial intelligence"

# Fuzzy search for approximate matches
ebook search "machine learning" -f

# Limit results and enable verbose output
ebook search "programming" -l 5 -v
```

### Viewing Index Statistics

Get comprehensive statistics about your search index:

```bash
# Basic index summary
ebook summary

# Show top 20 most frequent terms
ebook summary -k 20

# Verbose output with detailed analysis
ebook summary -v -k 15

# Use custom index file
ebook summary -i ./my-index.json -v
```

### Extracting PDF Covers

Extract cover images from PDF files:

```bash
# Extract cover from specific PDF
pdf-cover "Deep Learning.pdf" -o ./images

# Custom input directory
pdf-cover "book.pdf" -i /path/to/pdfs -o ./covers
```

### Legacy Metadata Extraction

For basic metadata extraction without search indexing:

```bash
# Extract metadata only
yarn dev

# Extract metadata with cover images
yarn dev -- --mode 2

# Interactive mode with options
yarn dev -- --config config.json
```

## ⚙️ Configuration

### Basic Configuration

The `config.json` file controls all aspects of the tool:

```json
{
  "includes": ["H:\\E-Books"],
  "excludes": ["H:\\E-Books\\backup"],
  "backupDir": "H:\\E-Books\\backup",
  "outputDir": "output",
  "dataFile": "data.json",
  "filenameReplacements": ["z-library", "libgen"],
  "tokenization": {
    "enabled": true,
    "mode": "bert",
    "bert": {
      "model": "Xenova/bert-base-uncased"
    }
  }
}
```

### Advanced Options

- **Memory Management**: Configure `maxMemoryUsageMB` and `maxFileSizeMB`
- **Batch Processing**: Set `batchSize` for memory-efficient processing
- **Tokenization**: Choose between `basic` and `bert` modes
- **Index Compression**: Enable/disable index compression

## 🔍 Search Features

### Query Types

- **Exact match**: `"machine learning"`
- **Fuzzy search**: `ebook search "machne learing" -f`
- **Multiple terms**: `"artificial intelligence neural networks"`

### Search Results

Each result includes:

- Title and author (when available)
- File path and type (PDF/EPUB)
- Relevance score
- Word and token counts
- Content excerpt

Example output:

```
Results for "machine learning":

1. Machine Learning Yearning.pdf
   Author: Andrew Ng
   Type: PDF
   Score: 0.95
   Word Count: 45,230
   Excerpt: Machine learning is the science of getting computers to learn...
   Path: H:\E-Books\AI\Machine Learning Yearning.pdf
```

### Index Statistics

The `summary` command provides comprehensive analytics:

- **Basic metrics**: Document count, term count, average document size
- **Top K frequent terms** with percentages of document coverage
- **Percentile analysis** (25th, 50th, 75th percentiles) of term frequencies
- **Term distribution** across frequency ranges (singleton, rare, common, etc.)
- **Memory usage** and performance metrics

Example summary output:

```
📊 Search Index Summary
==================================================

📈 Basic Statistics:
Total Documents: 1,200
Total Unique Terms: 4,421,733
Average Document Size: 12,463 tokens
Index File Size: 499.92 MB

📊 Term Frequency Distribution:
25th Percentile: 1
75th Percentile: 1

🔝 Top 5 Most Frequent Terms:
------------------------------------------------------------
Rank | Term      | Frequency | Percentage
------------------------------------------------------------
   1 | not       |      1125 |     93.75%
   2 | use       |      1121 |     93.42%
   3 | new       |      1117 |     93.08%
```

## 🛡️ Error Handling

The tool includes robust error handling:

- **Automatic PDF repair** using QPDF
- **Multiple extraction engines** with fallback
- **Memory monitoring** to prevent crashes
- **Graceful degradation** for problematic files
- **Comprehensive logging** in `logs/errors.log`

## 📊 Performance

### Memory Management

- **Dynamic heap sizing**: Automatically sets Node.js heap size based on `--max-memory` parameter
- **Streaming batch processing**: Processes and discards batches immediately to prevent memory accumulation
- **Real-time memory monitoring**: Tracks heap, external, and RSS memory usage during processing
- **Proactive garbage collection**: Forces garbage collection between batches to free memory
- **Configurable limits**: Default 4GB, configurable up to 32GB+ with proper system memory
- **Memory threshold warnings**: Alerts when approaching memory limits

### Processing Speed

- Incremental updates (only new/changed files)
- Parallel processing where possible
- Smart caching for repeated operations
- Efficient index storage with compression

## 📁 Project Structure

```
ebook-cli/
├── src/
│   ├── cli/              # Command-line interfaces
│   ├── v2/               # Legacy metadata extraction
│   ├── v3/               # Advanced workflow management
│   ├── search.ts         # Main search functionality
│   ├── textExtractor.ts  # Text extraction engines
│   └── searchIndex.ts    # Search index management
├── config.json           # Configuration file
├── package.json          # Dependencies and scripts
└── output/               # Generated files and indexes
```

## 🔧 Development

### Available Scripts

```bash
yarn dev         # Run development version
yarn build       # Build TypeScript to JavaScript
yarn start       # Build and run production version
yarn format      # Format code with Prettier
yarn lint        # Lint code with ESLint
yarn type-check  # Check TypeScript types
```

### Adding New Features

The project is designed with modularity in mind:

- Add new text extractors in `textExtractor.ts`
- Extend search functionality in `search.ts`
- Add CLI commands in `src/cli/`
- Configure new options in `config.json`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Run linting and formatting
6. Submit a pull request

## 📄 License

This project is licensed under the ISC License.

## 🆘 Troubleshooting

### Common Issues

**Memory errors during processing:**

```bash
# Reduce memory limits
ebook update --max-memory 2GB --max-file-size 50
```

**PDF extraction failures:**

```bash
# Install QPDF for automatic repair
# Windows: choco install qpdf
# macOS: brew install qpdf
# Linux: apt-get install qpdf
```

**Search index corruption:**

```bash
# Force rebuild the index
ebook update --force
```

### Getting Help

- Check the [Features Documentation](FEATURES.md) for detailed capabilities
- Review error logs in `logs/errors.log`
- Use verbose mode (`-v`) for detailed output
- Check configuration in `config.json`

## 🎯 Use Cases

- **Research**: Search across academic papers and textbooks
- **Library Management**: Organize and find books in large collections
- **Content Discovery**: Find relevant books by topic or content
- **Metadata Extraction**: Generate structured data from ebook files
- **Collection Analysis**: Analyze reading collections and content

---

For detailed feature documentation, see [FEATURES.md](FEATURES.md).
