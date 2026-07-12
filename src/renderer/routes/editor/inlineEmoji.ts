/**
 * Inline emoji in the text run (P7.11 — Doc 05 decorations; skill `text-render`,
 * `indic-text`).
 *
 * THE CORE FACT (and why this module is small): emoji are EXTENDED GRAPHEME
 * CLUSTERS. A simple emoji (🎉), a skin-tone–modified emoji (👍🏽 = base + U+1F3FD
 * modifier), and a ZWJ sequence (👩‍👩‍👧 = three people joined by U+200D) are each
 * ONE cluster under Unicode/ICU grapheme rules. The whole renderer already
 * operates on grapheme clusters — segmentation (`splitGraphemes` / `segmentClusters`),
 * layout (`layoutGlyphBoxes`), per-cluster arc/animation transforms
 * (`layoutArcClusters`), and character reveal (`revealedWordText` /
 * `revealedGraphemes`). So an emoji embedded in the run ("Great 🎉 job 👍🏽"):
 *   - is MEASURED as one cluster via the injected measurer (`ctx.measureText`
 *     returns the color-emoji advance), so its advance/metrics are correct;
 *   - participates in WORD boxes + LINE WIDTH + line WRAPPING like any cluster
 *     (an emoji-only token is just a one-cluster word);
 *   - gets a per-cluster TRANSFORM (curve, reveal, stagger) at its cluster index,
 *     exactly like a letter or a Tamil conjunct;
 *   - is DRAWN by the platform via `ctx.fillText` in the same per-cluster draw
 *     loop — the OS paints the color glyph, no special path.
 *
 * There is therefore NO emoji-specific layout/measure code: the inline-flow,
 * metrics, wrap, and animation requirements are met by the existing cluster
 * pipeline (the `inlineEmoji.test.ts` suite VERIFIES this end to end).
 *
 * What this module adds is the minimal AUTHORING affordance the prompt allows: a
 * cursor-aware insertion helper that inserts an emoji into a line at a cluster
 * index WITHOUT ever splitting a cluster (so you can never cut a ZWJ sequence or a
 * skin-tone modifier in half), plus tiny guards. PURE + headless-safe + tested —
 * it reuses the shared `splitGraphemes` so it shares ONE segmentation with the
 * layout/shaping pipeline.
 */
import { splitGraphemes, graphemeLength } from '../../../shared/captionSync'

/**
 * True when `text` is exactly ONE extended grapheme cluster (indic-text). Used to
 * validate an emoji token before insertion — a multi-cluster string (e.g. two
 * emoji, or "ab") is rejected so an "emoji" affordance only ever inserts a single
 * visible glyph cluster. PURE. (A ZWJ sequence / skin-tone-modified emoji is ONE
 * cluster, so it passes; "🎉🎉" is two clusters, so it fails.)
 */
export function isSingleCluster(text: string): boolean {
  return graphemeLength(text) === 1
}

/**
 * Insert `emoji` into `line` at the cluster index `clusterIndex` (0-based, in
 * GRAPHEME CLUSTERS — never code-point/UTF-16 offsets), returning the new line.
 * PURE.
 *
 * Operating on clusters guarantees the insertion point can never fall INSIDE a
 * cluster, so neither the existing text's clusters nor a multi-codepoint emoji
 * being inserted is ever split (no dotted-circle / broken-ZWJ artefact). The index
 * is CLAMPED to `[0, clusterCount]` so an out-of-range cursor inserts at the
 * nearest end rather than throwing:
 *   - `clusterIndex <= 0`            → prepend.
 *   - `clusterIndex >= clusterCount` → append.
 *   - else                           → splice between cluster `index-1` and `index`.
 *
 * The inserted `emoji` is placed verbatim (it may itself be a multi-codepoint
 * single cluster like 👍🏽 / 👩‍👩‍👧); the result re-segments to the original clusters
 * with the emoji slotted in at `clusterIndex`, so it immediately flows/wraps/animates
 * as one more cluster in the run. Reuses the shared `splitGraphemes` (ONE
 * segmentation with layout/shaping).
 */
export function insertEmojiAtCluster(line: string, emoji: string, clusterIndex: number): string {
  const clusters = splitGraphemes(line)
  const n = clusters.length
  const i = Number.isFinite(clusterIndex) ? Math.max(0, Math.min(Math.trunc(clusterIndex), n)) : n
  // Splice into the cluster array (never inside a cluster), then re-join.
  return [...clusters.slice(0, i), emoji, ...clusters.slice(i)].join('')
}

/**
 * Append `emoji` to the end of `line` (the common "insert at caret-at-end" case).
 * Sugar over {@link insertEmojiAtCluster}. PURE.
 */
export function appendEmoji(line: string, emoji: string): string {
  return line + emoji
}
