/**
 * Synthesis helpers for gather tool — task 14.04
 *
 * Lightweight local heuristics for relevance scoring and content deduplication.
 * No LLM/cloud dependencies.
 */

import type { ReadResult, SearchResult } from '../domain/types.js';

/** Minimum word count before applying deduplication (avoid false positives on short content) */
const MIN_DEDUP_WORD_COUNT = 20;

/** Jaccard similarity threshold for considering passages as duplicates */
const SIMILARITY_THRESHOLD = 0.6;

/** Shingle size (n-gram length) for similarity calculation */
const SHINGLE_SIZE = 3;

/**
 * Score relevance of content to a query using term overlap.
 * Returns a normalized score between 0 and 1.
 */
export function scoreRelevance(query: string, content: string): number {
  // Split by whitespace, underscores, and other non-word characters
  const tokenize = (text: string) =>
    text
      .toLowerCase()
      .split(/[\s_\-.,;:!?()[\]{}'"\/\\]+/)
      .filter(t => t.length > 1);
  
  const queryTerms = new Set(tokenize(query));
  
  if (queryTerms.size === 0) return 0;
  
  const contentTerms = new Set(tokenize(content));
  
  let overlap = 0;
  for (const term of queryTerms) {
    if (contentTerms.has(term)) overlap++;
  }
  
  return overlap / queryTerms.size;
}

/**
 * Generate n-word shingles (n-grams) from text.
 * Returns a Set of shingle strings.
 */
export function getShingles(text: string, n: number): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  const shingles = new Set<string>();
  
  if (words.length < n) {
    // For very short text, just use the whole thing as one shingle
    shingles.add(words.join(' '));
    return shingles;
  }
  
  for (let i = 0; i <= words.length - n; i++) {
    const shingle = words.slice(i, i + n).join(' ');
    shingles.add(shingle);
  }
  
  return shingles;
}

/**
 * Calculate Jaccard similarity between two texts using shingles.
 * Returns a value between 0 and 1.
 */
export function shingleSimilarity(a: string, b: string): number {
  const shinglesA = getShingles(a, SHINGLE_SIZE);
  const shinglesB = getShingles(b, SHINGLE_SIZE);
  
  if (shinglesA.size === 0 || shinglesB.size === 0) return 0;
  
  const intersection = new Set<string>();
  for (const s of shinglesA) {
    if (shinglesB.has(s)) intersection.add(s);
  }
  
  const union = new Set([...shinglesA, ...shinglesB]);
  
  return intersection.size / union.size;
}

/**
 * Scored read with relevance information for ordering.
 */
export interface ScoredRead {
  read: ReadResult;
  searchResult?: SearchResult;
  relevanceScore: number;
}

/**
 * Score reads by relevance using provider score or computed term overlap.
 * Associates each read with its search result for relevance lookup.
 */
export function scoreReads(
  reads: ReadResult[],
  searchResults: SearchResult[],
  query: string
): ScoredRead[] {
  return reads.map(read => {
    // Find matching search result by URL
    const searchResult = searchResults.find(sr => sr.url === read.url);
    
    let relevanceScore: number;
    if (searchResult?.relevance !== undefined && searchResult.relevance !== null) {
      // Use provider relevance if available
      relevanceScore = searchResult.relevance;
    } else {
      // Fall back to query term overlap
      const content = read.content ?? read.excerpt ?? '';
      relevanceScore = scoreRelevance(query, content);
    }
    
    return { read, searchResult, relevanceScore };
  });
}

/**
 * Deduplicate similar reads, keeping higher-relevance versions.
 * Returns deduplicated reads and count of removed duplicates.
 */
export function deduplicateReads(scoredReads: ScoredRead[]): {
  deduped: ScoredRead[];
  duplicatesRemoved: number;
} {
  if (scoredReads.length <= 1) {
    return { deduped: scoredReads, duplicatesRemoved: 0 };
  }
  
  // Sort by relevance descending first (so we keep higher-relevance versions)
  const sorted = [...scoredReads].sort((a, b) => b.relevanceScore - a.relevanceScore);
  
  const kept: ScoredRead[] = [];
  let duplicatesRemoved = 0;
  
  for (const candidate of sorted) {
    const candidateContent = candidate.read.content ?? candidate.read.excerpt ?? '';
    const candidateWords = candidateContent.split(/\s+/).length;
    
    // Skip dedup for very short content
    if (candidateWords < MIN_DEDUP_WORD_COUNT) {
      kept.push(candidate);
      continue;
    }
    
    // Check if this is a duplicate of any already-kept read
    let isDuplicate = false;
    for (const existing of kept) {
      const existingContent = existing.read.content ?? existing.read.excerpt ?? '';
      const existingWords = existingContent.split(/\s+/).length;
      
      // Only apply dedup if both are long enough
      if (existingWords >= MIN_DEDUP_WORD_COUNT) {
        const similarity = shingleSimilarity(candidateContent, existingContent);
        if (similarity >= SIMILARITY_THRESHOLD) {
          isDuplicate = true;
          duplicatesRemoved++;
          break;
        }
      }
    }
    
    if (!isDuplicate) {
      kept.push(candidate);
    }
  }
  
  return { deduped: kept, duplicatesRemoved };
}

/**
 * Build the synthesis body from scored, deduplicated reads.
 * Orders by relevance descending.
 */
export function buildSynthesisBody(
  _query: string,
  scoredReads: ScoredRead[]
): string {
  if (scoredReads.length === 0) {
    return '';
  }
  
  const lines: string[] = [];
  
  // Sort by relevance descending
  const sorted = [...scoredReads].sort((a, b) => b.relevanceScore - a.relevanceScore);
  
  for (const { read, searchResult } of sorted) {
    const title = read.title ?? searchResult?.title ?? 'Untitled';
    const url = read.url;
    const content = read.content ?? read.excerpt ?? '';
    
    lines.push(`### ${title}`);
    lines.push(`URL: ${url}`);
    lines.push('');
    lines.push(content);
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Build the degraded sources section for reads excluded from synthesis.
 */
export function buildDegradedSection(degradedCount: number): string {
  if (degradedCount === 0) return '';
  
  return [
    '---',
    '## Degraded Sources (excluded from synthesis)',
    `${degradedCount} source(s) returned insufficient content for reliable use.`,
  ].join('\n');
}
