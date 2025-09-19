/**
 * BERT tokenization utilities using @xenova/transformers
 * Provides advanced tokenization with WordPiece algorithm and contextual understanding
 */

import { AutoTokenizer, PreTrainedTokenizer } from '@xenova/transformers';

export interface BERTTokenizationResult {
  tokens: string[];
  inputIds: number[];
  attentionMask: number[];
  tokenCount: number;
  modelName: string;
}

class BERTTokenizerManager {
  private static instance: BERTTokenizerManager;
  private tokenizers: Map<string, PreTrainedTokenizer> = new Map();
  private loadingPromises: Map<string, Promise<PreTrainedTokenizer>> = new Map();

  static getInstance(): BERTTokenizerManager {
    if (!BERTTokenizerManager.instance) {
      BERTTokenizerManager.instance = new BERTTokenizerManager();
    }
    return BERTTokenizerManager.instance;
  }

  async getTokenizer(modelName: string = 'bert-base-uncased'): Promise<PreTrainedTokenizer> {
    // Return cached tokenizer if available
    if (this.tokenizers.has(modelName)) {
      return this.tokenizers.get(modelName)!;
    }

    // Return loading promise if already loading
    if (this.loadingPromises.has(modelName)) {
      return this.loadingPromises.get(modelName)!;
    }

    // Start loading tokenizer
    const loadingPromise = this.loadTokenizer(modelName);
    this.loadingPromises.set(modelName, loadingPromise);

    try {
      const tokenizer = await loadingPromise;
      this.tokenizers.set(modelName, tokenizer);
      this.loadingPromises.delete(modelName);
      return tokenizer;
    } catch (error) {
      this.loadingPromises.delete(modelName);
      throw error;
    }
  }

  private async loadTokenizer(modelName: string): Promise<PreTrainedTokenizer> {
    console.log(`🔄 Loading BERT tokenizer: ${modelName}...`);
    try {
      const tokenizer = await AutoTokenizer.from_pretrained(modelName);
      console.log(`✅ BERT tokenizer loaded: ${modelName}`);
      return tokenizer;
    } catch (error) {
      console.error(`❌ Failed to load BERT tokenizer ${modelName}:`, error);
      throw new Error(`Failed to load BERT tokenizer: ${modelName}`);
    }
  }

  clearCache(): void {
    this.tokenizers.clear();
    this.loadingPromises.clear();
  }
}

/**
 * Tokenizes text using BERT tokenizer with WordPiece algorithm
 */
export async function tokenizeWithBERT(
  text: string,
  modelName: string = 'bert-base-uncased',
): Promise<BERTTokenizationResult> {
  if (!text || typeof text !== 'string') {
    return {
      tokens: [],
      inputIds: [],
      attentionMask: [],
      tokenCount: 0,
      modelName,
    };
  }

  try {
    const tokenizerManager = BERTTokenizerManager.getInstance();
    const tokenizer = await tokenizerManager.getTokenizer(modelName);

    // Tokenize the text using the encoding approach
    const encoding = await tokenizer(text, {
      padding: false,
      truncation: false,
      return_tensors: null,
    });

    let tokens: string[] = [];
    let inputIds: number[] = [];
    let attentionMask: number[] = [];

    if (encoding.input_ids && Array.isArray(encoding.input_ids)) {
      inputIds = Array.from(encoding.input_ids).map((id: unknown) => Number(id));
      attentionMask = Array.from(encoding.attention_mask || []).map((mask: unknown) => Number(mask));

      // Use tokenizer's decode method for individual tokens
      tokens = [];
      for (const id of encoding.input_ids) {
        try {
          const token = tokenizer.decode([id], { skip_special_tokens: false });
          if (token && token.trim()) {
            tokens.push(token);
          }
        } catch {
          // Skip problematic tokens
        }
      }

      // Ensure all tokens are lowercased for uncased models
      if (modelName.includes('uncased')) {
        tokens = tokens.map((token) => token.toLowerCase());
      }
    } else {
      // Fallback: split text into words and lowercase
      tokens = text
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0);
    }

    return {
      tokens,
      inputIds,
      attentionMask,
      tokenCount: tokens.length,
      modelName,
    };
  } catch (error) {
    console.error(`❌ BERT tokenization failed:`, error);
    throw new Error(`BERT tokenization failed: ${(error as Error).message}`);
  }
}

/**
 * Tokenizes text for search indexing using BERT
 * Optimized for search by removing special tokens and normalizing
 */
export async function tokenizeForBERTSearch(text: string, modelName: string = 'bert-base-uncased'): Promise<string[]> {
  try {
    const result = await tokenizeWithBERT(text, modelName);

    // Filter out special tokens ([CLS], [SEP], [PAD], etc.)
    const searchTokens = result.tokens.filter(
      (token) => !token.startsWith('[') && !token.endsWith(']') && token.length > 1,
    );

    // Remove common English stopwords for search efficiency
    const filteredTokens = searchTokens.filter((token) => !isStopword(token.toLowerCase()));

    // Ensure all tokens are lowercased for consistency (BERT uncased should already do this, but be safe)
    const normalizedTokens = filteredTokens.map((token) => token.toLowerCase());

    // Remove duplicates and return
    return [...new Set(normalizedTokens)];
  } catch (error) {
    console.warn(`⚠️ BERT tokenization failed, falling back to basic tokenization:`, error);
    // Fallback to basic tokenization if BERT fails
    return basicTokenizeForSearch(text);
  }
}

/**
 * Basic tokenization fallback when BERT is not available
 */
function basicTokenizeForSearch(text: string): string[] {
  if (!text) return [];

  // Simple word tokenization
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);

  return [...new Set(words)];
}

/**
 * Checks if a token is a common English stopword
 */
function isStopword(token: string): boolean {
  const stopwords = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'by',
    'for',
    'from',
    'has',
    'he',
    'in',
    'is',
    'it',
    'its',
    'of',
    'on',
    'that',
    'the',
    'to',
    'was',
    'will',
    'with',
    'but',
    'or',
    'not',
    'this',
    'these',
    'those',
    'i',
    'me',
    'my',
    'myself',
    'we',
    'our',
    'ours',
    'you',
    'your',
    'yours',
    'he',
    'him',
    'his',
    'she',
    'her',
    'hers',
    'it',
    'its',
    'they',
    'them',
    'their',
    'theirs',
    'what',
    'which',
    'who',
    'whom',
    'this',
    'that',
    'these',
    'those',
    'am',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'must',
    'shall',
    'can',
    'will',
    'about',
    'above',
    'after',
    'again',
    'against',
    'all',
    'am',
    'an',
    'and',
    'any',
    'are',
    'as',
    'at',
    'be',
    'because',
    'been',
    'before',
    'being',
    'below',
    'between',
    'both',
    'but',
    'by',
    'can',
    'cannot',
    'could',
    'did',
    'do',
    'does',
    'doing',
    'down',
    'during',
    'each',
    'few',
    'for',
    'from',
    'further',
    'had',
    'has',
    'have',
    'having',
    'he',
    'her',
    'here',
    'hers',
    'herself',
    'him',
    'himself',
    'his',
    'how',
    'i',
    'if',
    'in',
    'into',
    'is',
    'it',
    'its',
    'itself',
    'me',
    'more',
    'most',
    'my',
    'myself',
    'no',
    'nor',
    'not',
    'of',
    'off',
    'on',
    'once',
    'only',
    'or',
    'other',
    'ought',
    'our',
    'ours',
    'ourselves',
    'out',
    'over',
    'own',
    'same',
    'she',
    'should',
    'so',
    'some',
    'such',
    'than',
    'that',
    'the',
    'their',
    'theirs',
    'them',
    'themselves',
    'then',
    'there',
    'these',
    'they',
    'this',
    'those',
    'through',
    'to',
    'too',
    'under',
    'until',
    'up',
    'very',
    'was',
    'we',
    'were',
    'what',
    'when',
    'where',
    'which',
    'while',
    'who',
    'whom',
    'why',
    'will',
    'with',
    'would',
    'you',
    'your',
    'yours',
    'yourself',
    'yourselves',
  ]);

  return stopwords.has(token);
}

/**
 * Checks if BERT tokenizer is available
 */
export async function isBERTAvailable(modelName: string = 'bert-base-uncased'): Promise<boolean> {
  try {
    const tokenizerManager = BERTTokenizerManager.getInstance();
    await tokenizerManager.getTokenizer(modelName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets available BERT models for different use cases
 */
export const BERT_MODELS = {
  // English models
  'bert-base-uncased': 'General purpose, fast',
  'bert-base-cased': 'Case-sensitive, better for proper nouns',
  'bert-large-uncased': 'Higher accuracy, slower',
  'bert-large-cased': 'Highest accuracy, case-sensitive',

  // Multilingual models
  'bert-base-multilingual-uncased': 'Supports 100+ languages',
  'bert-base-multilingual-cased': 'Multilingual with case sensitivity',

  // Domain-specific models
  'microsoft/DialoGPT-small': 'Conversational AI',
  'distilbert-base-uncased': 'Faster, smaller model',
} as const;

export type BERTModelName = keyof typeof BERT_MODELS;
