#!/usr/bin/env python3
"""
CTC forced-alignment sidecar for lyrics-first captioning.

Reads a JSON request on stdin, aligns the KNOWN lyric words to the audio with
torchaudio's multilingual MMS forced-alignment bundle (wav2vec2 CTC, covers
Tamil/Telugu/Malayalam/Kannada/Hindi + English), and writes a JSON response on
stdout. The words are never invented or changed — only per-word timing (start,
end, score) is computed. The renderer/main process treats a non-zero exit or an
{"ok": false} body as "aligner unavailable" and falls back to VAD phrase-sync.

Request  (stdin):
  { "wav_path": str, "language": str|null, "words": [str, ...],
    "segments": [[start_sec, end_sec], ...] | null }
Response (stdout):
  { "ok": true, "sample_rate": 16000,
    "words": [ {"start": float, "end": float, "score": float} | null, ... ] }
  (null entries = words whose romanization was empty, e.g. pure punctuation;
   the caller interpolates their timing.)

Design notes:
  * MMS_FA works at 16 kHz mono — exactly the normalized WAV the app produces.
  * Non-Latin scripts are romanized with `uroman`, then reduced to the model's
    lowercase-latin dictionary, per the torchaudio MMS forced-alignment recipe.
  * When `segments` (VAD vocal regions) are provided, alignment runs chunk-by-
    chunk: words are distributed across segments proportionally by segment
    duration, each segment is aligned independently, and the per-word timings
    are stitched back into global time coordinates. This prevents CTC drift
    on long audio (>3 min) where monolithic alignment compresses tail words.
  * Segment padding (0.3s each side) captures onset/tail phonemes that a tight
    VAD boundary might clip.
"""
import json
import math
import re
import sys


# uroman language codes for the supported UI languages (best-effort; uroman also
# auto-detects script when lcode is unknown).
_UROMAN_LCODE = {
    "ta": "tam", "te": "tel", "ml": "mal", "kn": "kan", "hi": "hin", "en": "eng",
}

_KEEP = re.compile(r"[^a-z' ]+")

# Segment padding (seconds) on each side when slicing the waveform for a segment.
# Captures onset/tail phonemes that a tight VAD boundary might clip.
_SEGMENT_PAD_SEC = 0.3

# Maximum segment duration (seconds) before we sub-split. Segments longer than
# this are split into equal sub-chunks to keep CTC alignment accurate.
_MAX_SEGMENT_SEC = 30.0

# Minimum words to justify running alignment on a segment. If a segment gets
# fewer words than this, they're merged with an adjacent segment.
_MIN_WORDS_PER_SEGMENT = 3


def _fail(msg: str) -> None:
    json.dump({"ok": False, "error": msg}, sys.stdout)
    sys.stdout.flush()
    sys.exit(1)


def _romanize_words(words: list[str], language: str | None) -> list[str]:
    """Romanize + normalize each lyric word to the MMS dictionary."""
    import uroman as _uroman
    uroman = _uroman.Uroman()
    lcode = _UROMAN_LCODE.get((language or "").lower())
    norm: list[str] = []
    for w in words:
        try:
            r = uroman.romanize_string(w, lcode=lcode) if lcode else uroman.romanize_string(w)
        except Exception:  # noqa: BLE001
            r = w
        r = _KEEP.sub("", r.lower()).strip()
        norm.append(r)
    return norm


def _align_segment(
    waveform,  # torch.Tensor (1, samples) at bundle.sample_rate
    sr: int,
    words: list[str],  # original words for this segment
    norm: list[str],    # romanized words for this segment
    model, tokenizer, aligner, device,
    time_offset: float = 0.0,  # global time offset for this segment
) -> list:
    """Align a single audio segment against its word subset.

    Returns a list of length len(words), each either
    {"start": float, "end": float, "score": float} or None.
    """
    import torch

    out: list = [None] * len(words)

    # Which words have non-empty romanizations (the aligner can see)?
    align_idx = [i for i, r in enumerate(norm) if r]
    transcript = [norm[i] for i in align_idx]
    if len(transcript) == 0:
        return out

    with torch.inference_mode():
        emission, _ = model(waveform.to(device))
        token_spans = aligner(emission[0], tokenizer(transcript))

    # Frames → seconds. emission time dim maps to the waveform length.
    num_frames = emission.size(1)
    ratio = waveform.size(1) / num_frames / sr

    for orig_i, spans in zip(align_idx, token_spans):
        if not spans:
            continue
        start = spans[0].start * ratio + time_offset
        end = spans[-1].end * ratio + time_offset
        score = sum(s.score * (s.end - s.start) for s in spans) / max(
            1, sum((s.end - s.start) for s in spans)
        )
        out[orig_i] = {"start": float(start), "end": float(end), "score": float(score)}

    return out


def _distribute_words_to_segments(
    n_words: int,
    segments: list[list[float]],
) -> list[tuple[int, int]]:
    """Distribute n_words across segments proportionally by segment duration.

    Returns a list of (start_word_idx, end_word_idx) tuples — one per segment.
    Each range is exclusive-end. Adjacent ranges tile [0, n_words) completely.
    """
    total_dur = sum(max(0, seg[1] - seg[0]) for seg in segments)
    if total_dur <= 0 or n_words <= 0:
        return [(0, n_words)] if len(segments) == 1 else [(0, 0)] * len(segments)

    ranges: list[tuple[int, int]] = []
    cursor = 0
    for i, seg in enumerate(segments):
        dur = max(0, seg[1] - seg[0])
        if i == len(segments) - 1:
            # Last segment gets all remaining words.
            ranges.append((cursor, n_words))
        else:
            fraction = dur / total_dur
            count = max(1, round(n_words * fraction))
            end = min(cursor + count, n_words)
            ranges.append((cursor, end))
            cursor = end

    # Ensure no empty segments in the middle by merging forward.
    for i in range(len(ranges)):
        s, e = ranges[i]
        if s >= e and i + 1 < len(ranges):
            # Empty: give at least 1 word from the next segment if possible.
            ns, ne = ranges[i + 1]
            if ne > ns:
                ranges[i] = (s, s + 1)
                ranges[i + 1] = (s + 1, ne)

    return ranges


def _merge_small_segments(
    segments: list[list[float]],
    word_ranges: list[tuple[int, int]],
    min_words: int,
) -> tuple[list[list[float]], list[tuple[int, int]]]:
    """Merge segments that have too few words with their neighbors."""
    if len(segments) <= 1:
        return segments, word_ranges

    merged_segs: list[list[float]] = []
    merged_ranges: list[tuple[int, int]] = []

    for i in range(len(segments)):
        seg = segments[i]
        wr = word_ranges[i]
        n = wr[1] - wr[0]

        if merged_segs and n < min_words:
            # Merge with previous.
            merged_segs[-1] = [merged_segs[-1][0], max(merged_segs[-1][1], seg[1])]
            merged_ranges[-1] = (merged_ranges[-1][0], wr[1])
        else:
            merged_segs.append(list(seg))
            merged_ranges.append(wr)

    return merged_segs, merged_ranges


def _sub_split_long_segments(
    segments: list[list[float]],
    word_ranges: list[tuple[int, int]],
    max_dur: float,
) -> tuple[list[list[float]], list[tuple[int, int]]]:
    """Split segments longer than max_dur into equal sub-chunks."""
    out_segs: list[list[float]] = []
    out_ranges: list[tuple[int, int]] = []

    for seg, wr in zip(segments, word_ranges):
        dur = seg[1] - seg[0]
        n_words = wr[1] - wr[0]

        if dur <= max_dur or n_words <= _MIN_WORDS_PER_SEGMENT:
            out_segs.append(seg)
            out_ranges.append(wr)
            continue

        n_chunks = max(2, math.ceil(dur / max_dur))
        chunk_dur = dur / n_chunks
        words_per_chunk = n_words / n_chunks
        cursor = wr[0]

        for c in range(n_chunks):
            chunk_start = seg[0] + c * chunk_dur
            chunk_end = seg[0] + (c + 1) * chunk_dur if c < n_chunks - 1 else seg[1]

            if c == n_chunks - 1:
                word_end = wr[1]
            else:
                word_end = min(wr[1], round(wr[0] + (c + 1) * words_per_chunk))
                word_end = max(word_end, cursor + 1)  # At least 1 word

            out_segs.append([chunk_start, chunk_end])
            out_ranges.append((cursor, word_end))
            cursor = word_end

    return out_segs, out_ranges


def main() -> None:
    # Ensure UTF-8 encoding for IPC pipes on Windows
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    
    try:
        req = json.load(sys.stdin)
    except Exception as exc:  # noqa: BLE001
        _fail(f"bad request json: {exc}")

    wav_path = req.get("wav_path")
    language = req.get("language")
    words = req.get("words") or []
    segments = req.get("segments")  # Optional: [[start_sec, end_sec], ...]
    if not wav_path or not isinstance(words, list) or len(words) == 0:
        _fail("request missing wav_path or words")

    try:
        import torch
        import torchaudio
        import soundfile as sf
        from torchaudio.pipelines import MMS_FA as bundle
    except Exception as exc:  # noqa: BLE001
        _fail(f"python deps unavailable: {exc}")

    # --- Romanize + normalize each lyric word to the model dictionary ---
    norm = _romanize_words(words, language)

    # Words the aligner can actually see (non-empty); check we have any.
    alignable_count = sum(1 for r in norm if r)
    if alignable_count == 0:
        _fail("no alignable tokens after romanization")

    try:
        device = torch.device("cpu")
        model = bundle.get_model().to(device)
        tokenizer = bundle.get_tokenizer()
        aligner = bundle.get_aligner()

        # Load via soundfile (torchaudio.load now requires TorchCodec). The input
        # is always the app's canonical PCM WAV, so soundfile handles it directly.
        data, sr = sf.read(wav_path, dtype="float32", always_2d=True)  # (frames, ch)
        waveform = torch.from_numpy(data.T).contiguous()  # (ch, frames)
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)
        if sr != bundle.sample_rate:
            waveform = torchaudio.functional.resample(waveform, sr, bundle.sample_rate)
            sr = bundle.sample_rate

        total_samples = waveform.size(1)
        total_duration = total_samples / sr

        # --- Segmented or monolithic alignment ---
        if segments and isinstance(segments, list) and len(segments) >= 2:
            # Validate and clean segments.
            clean_segs: list[list[float]] = []
            for seg in segments:
                if isinstance(seg, (list, tuple)) and len(seg) >= 2:
                    s, e = float(seg[0]), float(seg[1])
                    if e > s and s < total_duration:
                        clean_segs.append([s, min(e, total_duration)])

            if len(clean_segs) < 2:
                # Fall back to monolithic if segments are invalid.
                clean_segs = []

            if clean_segs:
                # Distribute words proportionally across segments.
                word_ranges = _distribute_words_to_segments(len(words), clean_segs)

                # Merge tiny segments, then sub-split overlong ones.
                clean_segs, word_ranges = _merge_small_segments(
                    clean_segs, word_ranges, _MIN_WORDS_PER_SEGMENT
                )
                clean_segs, word_ranges = _sub_split_long_segments(
                    clean_segs, word_ranges, _MAX_SEGMENT_SEC
                )

                # Align each segment independently.
                out: list = [None] * len(words)
                for seg, (w_start, w_end) in zip(clean_segs, word_ranges):
                    if w_start >= w_end:
                        continue

                    seg_words = words[w_start:w_end]
                    seg_norm = norm[w_start:w_end]

                    # Slice waveform for this segment (with padding).
                    pad_start = max(0, seg[0] - _SEGMENT_PAD_SEC)
                    pad_end = min(total_duration, seg[1] + _SEGMENT_PAD_SEC)
                    sample_start = int(pad_start * sr)
                    sample_end = min(total_samples, int(pad_end * sr))

                    if sample_end <= sample_start:
                        continue

                    seg_waveform = waveform[:, sample_start:sample_end]
                    seg_offset = pad_start  # global time offset

                    seg_results = _align_segment(
                        seg_waveform, sr,
                        seg_words, seg_norm,
                        model, tokenizer, aligner, device,
                        time_offset=seg_offset,
                    )

                    # Clamp word timings to be within the segment bounds (not the
                    # padded region — padding is for phoneme capture, not timing).
                    for k, result in enumerate(seg_results):
                        if result is not None:
                            result["start"] = max(result["start"], seg[0])
                            result["end"] = min(result["end"], seg[1])
                            if result["end"] <= result["start"]:
                                result["end"] = result["start"] + 0.02
                        out[w_start + k] = result

                json.dump({"ok": True, "sample_rate": int(sr), "words": out}, sys.stdout)
                sys.stdout.flush()
                return

        # --- Monolithic alignment (no segments or single segment) ---
        out = _align_segment(
            waveform, sr,
            words, norm,
            model, tokenizer, aligner, device,
            time_offset=0.0,
        )

    except Exception as exc:  # noqa: BLE001
        _fail(f"alignment failed: {exc}")

    json.dump({"ok": True, "sample_rate": int(sr), "words": out}, sys.stdout)
    sys.stdout.flush()


if __name__ == "__main__":
    main()
