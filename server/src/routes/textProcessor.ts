/**
 * textProcessor.ts
 *
 * Express route handler for intelligently segmenting devotional poetry into
 * rhythmically balanced video caption lines using the Google Gemini API.
 *
 * Endpoint: POST /api/process-text
 *
 * Request body:
 *   {
 *     text:     string  — raw devotional verse (any supported script)
 *     language: string  — BCP-47 language hint ('ta' | 'te' | 'ml' | 'hi' | 'en')
 *     maxWords: number? — override maximum words per chunk (default: 4)
 *   }
 *
 * Response body (success):
 *   {
 *     chunks:   string[]  — segmented lyric phrases
 *     source:   'gemini' | 'fallback'
 *     model:    string
 *     latencyMs: number
 *   }
 *
 * Response body (error):
 *   { error: string; details?: string }
 */

import { Router, Request, Response } from 'express';
import { GoogleGenAI, Type } from '@google/genai';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ProcessTextRequestBody {
  text: string;
  language?: 'ta' | 'te' | 'ml' | 'hi' | 'en';
  maxWords?: number;
}

interface ProcessTextResponse {
  chunks: string[];
  source: 'gemini' | 'fallback';
  model: string;
  latencyMs: number;
}

interface GeminiChunkOutput {
  chunks: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MODEL_ID = 'gemini-2.5-flash';

/**
 * Elite system prompt crafted for classical Hindu devotional poetry parsing
 * across five script traditions. The precise rule constraints force the model
 * to honour Unicode ligature boundaries and rhythmic phrase cadences.
 */
const SYSTEM_INSTRUCTION = `\
You are an elite linguistic automation engine specializing in classical Hindu \
devotional poetry across Tamil (e.g., Abirami Anthathi), Telugu, Malayalam, \
Hindi, and English scriptures. Your sole mission is to take an unstructured \
verse paragraph block and segment it into structurally sound, rhythmically \
balanced video caption lines.

Rules:
- Each string phrase item in the array MUST contain between 2 to 4 words maximum.
- Never break a sacred word compound boundary arbitrarily; maintain semantic \
linguistic integrity.
- Preserve all native characters, pulling vowels, pulli dots, and special \
diacritics precisely.
- Output must strictly match the language format input into the model engine.
- Do not add transliterations, translations, or annotations of any kind.
- Empty strings are strictly forbidden in the output array.
- Prefer breaking at natural breath pause positions in classical metres \
(e.g., after anusvāra, virama, or punctuation marks if present).`;

/**
 * Structured output schema — forces Gemini to return a valid JSON object with
 * a `chunks` array of strings and nothing else.
 */
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    chunks: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
      },
      description: 'Array of broken lyric phrases, each containing 2-4 words',
    },
  },
  required: ['chunks'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Gemini client — instantiated once per process, shared across requests
// ─────────────────────────────────────────────────────────────────────────────

function createGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    console.warn(
      '[TextProcessor] GEMINI_API_KEY is not configured. ' +
        'All requests will use the regex fallback engine.'
    );
    return null;
  }
  return new GoogleGenAI({ apiKey });
}

const geminiClient: GoogleGenAI | null = createGeminiClient();

// ─────────────────────────────────────────────────────────────────────────────
// Fallback: Unicode-aware regex segmentation engine
//
// Used when:
//   a) GEMINI_API_KEY is not set
//   b) The Gemini API call throws any error
//   c) The model returns malformed JSON
//
// Algorithm:
//   1. Normalise the input: collapse whitespace, strip leading/trailing blanks.
//   2. Split on natural verse boundaries (newlines, em-dashes, semicolons).
//   3. Within each segment, split the token stream into groups of `maxWords`.
//   4. Filter out any empty strings produced by multi-space sequences.
//
// This approach handles all Unicode scripts correctly because JavaScript's
// String.prototype.split(/\s+/) is Unicode-aware and will not fracture Indic
// conjunct consonant clusters which are encoded as single code points.
// ─────────────────────────────────────────────────────────────────────────────

function regexFallbackSplit(text: string, maxWords: number): string[] {
  // Step 1 — Normalise
  const normalised = text
    .trim()
    .replace(/\r\n/g, '\n')          // Windows line endings → Unix
    .replace(/\r/g, '\n')            // Old-style CR → Unix
    .replace(/[ \t]+/g, ' ')        // Collapse horizontal whitespace
    .replace(/\n{3,}/g, '\n\n');    // Collapse excessive blank lines

  // Step 2 — Split on hard verse boundaries first
  const verseBoundaryRe = /[\n।॥|؟،\u0964\u0965]+/u;
  const verseSegments = normalised
    .split(verseBoundaryRe)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const chunks: string[] = [];

  for (const segment of verseSegments) {
    // Step 3 — Tokenise on whitespace (Unicode-safe)
    const tokens = segment.split(/\s+/).filter((t) => t.length > 0);

    // Step 4 — Group into maxWords-sized windows
    for (let i = 0; i < tokens.length; i += maxWords) {
      const phrase = tokens.slice(i, i + maxWords).join(' ');
      if (phrase.trim().length > 0) {
        chunks.push(phrase);
      }
    }
  }

  // Guard: if the input was a single token with no spaces (e.g. a URL or
  // a malformed payload), return it as a single-element array.
  return chunks.length > 0 ? chunks : [text.trim()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini API call — isolated so the catch block can cleanly fall back
// ─────────────────────────────────────────────────────────────────────────────

async function callGeminiProcessor(
  client: GoogleGenAI,
  text: string,
  language: string,
  maxWords: number
): Promise<string[]> {
  const languageLabels: Record<string, string> = {
    ta: 'Tamil',
    te: 'Telugu',
    ml: 'Malayalam',
    hi: 'Hindi',
    en: 'English',
  };

  const languageLabel = languageLabels[language] ?? 'the original language';

  const userPrompt = `\
Script language: ${languageLabel}
Maximum words per chunk: ${maxWords}

Devotional verse to segment:
"""
${text}
"""

Return a JSON object with a single key "chunks" containing an array of \
rhythmically balanced lyric phrases. Each phrase must be ${maxWords} words \
or fewer. Preserve every character exactly as written.`;

  const response = await client.models.generateContent({
    model: MODEL_ID,
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      // Temperature 0 for deterministic, structured outputs
      temperature: 0,
      // Allow generous token budget for long devotional verses
      maxOutputTokens: 2048,
    },
  });

  const rawText = response.text;

  if (!rawText) {
    throw new Error('Gemini returned an empty response body');
  }

  // The model is constrained by responseSchema so this should always succeed,
  // but we guard defensively against partial streaming edge cases.
  let parsed: GeminiChunkOutput;
  try {
    parsed = JSON.parse(rawText) as GeminiChunkOutput;
  } catch {
    throw new Error(
      `Gemini response is not valid JSON. Raw: ${rawText.slice(0, 200)}`
    );
  }

  if (!Array.isArray(parsed.chunks) || parsed.chunks.length === 0) {
    throw new Error('Gemini response missing valid "chunks" array');
  }

  // Sanitise: remove empty strings the model may produce despite instructions
  return parsed.chunks.filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Request validation helpers
// ─────────────────────────────────────────────────────────────────────────────

const SUPPORTED_LANGUAGES = new Set(['ta', 'te', 'ml', 'hi', 'en']);
const MAX_TEXT_LENGTH = 8_000; // characters
const MIN_TEXT_LENGTH = 2;
const DEFAULT_MAX_WORDS = 4;
const MAX_WORDS_CEILING = 10;

function validateBody(
  body: unknown
): { valid: true; data: ProcessTextRequestBody } | { valid: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, error: 'Request body must be a JSON object.' };
  }

  const b = body as Record<string, unknown>;

  if (typeof b['text'] !== 'string') {
    return { valid: false, error: '"text" field must be a string.' };
  }

  const text = b['text'].trim();

  if (text.length < MIN_TEXT_LENGTH) {
    return { valid: false, error: '"text" must contain at least 2 characters.' };
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return {
      valid: false,
      error: `"text" exceeds the maximum allowed length of ${MAX_TEXT_LENGTH} characters.`,
    };
  }

  const language = (b['language'] as string | undefined) ?? 'ta';
  if (!SUPPORTED_LANGUAGES.has(language)) {
    return {
      valid: false,
      error: `"language" must be one of: ${[...SUPPORTED_LANGUAGES].join(', ')}.`,
    };
  }

  let maxWords = DEFAULT_MAX_WORDS;
  if (b['maxWords'] !== undefined) {
    const mw = Number(b['maxWords']);
    if (!Number.isInteger(mw) || mw < 1 || mw > MAX_WORDS_CEILING) {
      return {
        valid: false,
        error: `"maxWords" must be an integer between 1 and ${MAX_WORDS_CEILING}.`,
      };
    }
    maxWords = mw;
  }

  return {
    valid: true,
    data: {
      text,
      language: language as ProcessTextRequestBody['language'],
      maxWords,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

/**
 * POST /api/process-text
 *
 * Segments devotional poetry into rhythmically balanced caption chunks using
 * the Gemini 2.5 Flash model with structured JSON output.
 *
 * Falls back transparently to the Unicode-aware regex engine if:
 *  - The GEMINI_API_KEY is not configured
 *  - Any network or model error occurs
 *  - The model returns malformed or empty output
 */
router.post(
  '/',
  async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();

    // ── Input validation ────────────────────────────────────────────────────
    const validation = validateBody(req.body);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const { text, language = 'ta', maxWords = DEFAULT_MAX_WORDS } = validation.data;

    console.info(
      `[TextProcessor] POST /api/process-text | lang=${language} | ` +
        `chars=${text.length} | maxWords=${maxWords} | ` +
        `geminiAvailable=${geminiClient !== null}`
    );

    // ── Attempt Gemini processing ───────────────────────────────────────────
    if (geminiClient !== null) {
      try {
        const chunks = await callGeminiProcessor(
          geminiClient,
          text,
          language,
          maxWords
        );

        const response: ProcessTextResponse = {
          chunks,
          source: 'gemini',
          model: MODEL_ID,
          latencyMs: Date.now() - startTime,
        };

        console.info(
          `[TextProcessor] Gemini success | chunks=${chunks.length} | ` +
            `latency=${response.latencyMs}ms`
        );

        res.status(200).json(response);
        return;
      } catch (geminiError) {
        // Log the full error but degrade gracefully to the fallback engine
        console.error(
          '[TextProcessor] Gemini API error — falling back to regex engine:',
          geminiError instanceof Error ? geminiError.message : geminiError
        );
      }
    }

    // ── Fallback: regex-based segmentation ──────────────────────────────────
    try {
      const chunks = regexFallbackSplit(text, maxWords);

      const response: ProcessTextResponse = {
        chunks,
        source: 'fallback',
        model: 'regex-unicode-v1',
        latencyMs: Date.now() - startTime,
      };

      console.info(
        `[TextProcessor] Fallback success | chunks=${chunks.length} | ` +
          `latency=${response.latencyMs}ms`
      );

      res.status(200).json(response);
    } catch (fallbackError) {
      // This should be unreachable — regexFallbackSplit is pure and
      // cannot throw for any valid UTF-8 string input.
      console.error('[TextProcessor] Fatal: fallback engine failed:', fallbackError);
      res.status(500).json({
        error: 'Internal server error during text segmentation.',
        details:
          process.env.NODE_ENV === 'development'
            ? String(fallbackError)
            : undefined,
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Health check — lightweight endpoint for uptime monitoring and readiness
// ─────────────────────────────────────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response): void => {
  res.status(200).json({
    status: 'ok',
    service: 'divya-textstyler-processor',
    model: MODEL_ID,
    geminiConfigured: geminiClient !== null,
    timestamp: new Date().toISOString(),
  });
});

export default router;
