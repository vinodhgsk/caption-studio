export interface WordBoundary {
  word: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Parses a string of text into word boundaries, returning the exact start
 * and end indices of each word.
 *
 * This function accounts for complex Unicode surrogate pairs and grapheme clusters
 * (essential for Tamil Uyirmei letters) so that highlighting engines won't split
 * a vowel modifier from its base consonant.
 *
 * @param text The complete text string to parse
 * @param encoding The encoding type ('unicode' or 'bamini')
 * @returns Array of WordBoundary objects containing the word and its grapheme indices
 */
export function parseWordBoundaries(text: string, encoding: 'unicode' | 'bamini'): WordBoundary[] {
  if (!text || !text.trim()) return [];

  const boundaries: WordBoundary[] = [];

  try {
    // Attempt to use Intl.Segmenter for highly accurate grapheme and word segmentation.
    // It properly groups complex Indic scripts (like Tamil) into cohesive graphemes.
    const locale = encoding === 'unicode' ? 'ta-IN' : 'en-US';
    const Segmenter = (Intl as any).Segmenter;
    if (!Segmenter) throw new Error("Intl.Segmenter not found");
    const wordSegmenter = new Segmenter(locale, { granularity: 'word' });
    const graphemeSegmenter = new Segmenter(locale, { granularity: 'grapheme' });

    let currentGraphemeIndex = 0;
    const segments = wordSegmenter.segment(text);

    for (const segment of segments) {
      // Calculate how many precise grapheme clusters exist within this segment
      const segmentGraphemes = Array.from(graphemeSegmenter.segment(segment.segment));
      const segmentLength = segmentGraphemes.length;

      // isWordLike filters out whitespace and pure punctuation blocks depending on locale
      if (segment.isWordLike) {
        boundaries.push({
          word: segment.segment,
          startIndex: currentGraphemeIndex,
          // endIndex is inclusive of the final grapheme
          endIndex: currentGraphemeIndex + segmentLength - 1,
        });
      }
      currentGraphemeIndex += segmentLength;
    }

    return boundaries;
  } catch (e) {
    // Fallback for environments where Intl.Segmenter is unavailable
    console.warn('Intl.Segmenter not supported. Falling back to Array.from grapheme counting.');

    // Array.from safely splits Unicode surrogate pairs into discrete string characters,
    // though it might not bind all complex vowel-modifiers to consonants like Intl.Segmenter.
    const words = text.trim().split(/\s+/);
    const allCharacters = Array.from(text);
    
    let searchStartIndex = 0;

    for (const word of words) {
      if (!word) continue;

      const wordCharacters = Array.from(word);
      const wordLength = wordCharacters.length;

      // Find the word in the full character array to get accurate indices (accounting for varying whitespace)
      let foundIndex = -1;
      for (let i = searchStartIndex; i <= allCharacters.length - wordLength; i++) {
        let match = true;
        for (let j = 0; j < wordLength; j++) {
          if (allCharacters[i + j] !== wordCharacters[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          foundIndex = i;
          break;
        }
      }

      if (foundIndex !== -1) {
        boundaries.push({
          word,
          startIndex: foundIndex,
          endIndex: foundIndex + wordLength - 1,
        });
        searchStartIndex = foundIndex + wordLength;
      }
    }

    return boundaries;
  }
}
