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
  { "wav_path": str, "language": str|null, "words": [str, ...] }
Response (stdout):
  { "ok": true, "sample_rate": 16000,
    "words": [ {"start": float, "end": float, "score": float} | null, ... ] }
  (null entries = words whose romanization was empty, e.g. pure punctuation;
   the caller interpolates their timing.)

Design notes:
  * MMS_FA works at 16 kHz mono — exactly the normalized WAV the app produces.
  * Non-Latin scripts are romanized with `uroman`, then reduced to the model's
    lowercase-latin dictionary, per the torchaudio MMS forced-alignment recipe.
  * Alignment runs only over detected voiced spans is NOT done here; the model
    sees the whole file so CTC blanks absorb instrumental gaps naturally.
"""
import json
import re
import sys


# uroman language codes for the supported UI languages (best-effort; uroman also
# auto-detects script when lcode is unknown).
_UROMAN_LCODE = {
    "ta": "tam", "te": "tel", "ml": "mal", "kn": "kan", "hi": "hin", "en": "eng",
}

_KEEP = re.compile(r"[^a-z' ]+")


def _fail(msg: str) -> None:
    json.dump({"ok": False, "error": msg}, sys.stdout)
    sys.stdout.flush()
    sys.exit(1)


def main() -> None:
    try:
        req = json.load(sys.stdin)
    except Exception as exc:  # noqa: BLE001
        _fail(f"bad request json: {exc}")

    wav_path = req.get("wav_path")
    language = req.get("language")
    words = req.get("words") or []
    if not wav_path or not isinstance(words, list) or len(words) == 0:
        _fail("request missing wav_path or words")

    try:
        import torch
        import torchaudio
        import soundfile as sf
        from torchaudio.pipelines import MMS_FA as bundle
        import uroman as _uroman
    except Exception as exc:  # noqa: BLE001
        _fail(f"python deps unavailable: {exc}")

    # --- Romanize + normalize each lyric word to the model dictionary ---
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

    # Words the aligner can actually see (non-empty); keep a map back to originals.
    align_idx = [i for i, r in enumerate(norm) if r]
    transcript = [norm[i] for i in align_idx]
    if len(transcript) == 0:
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

        with torch.inference_mode():
            emission, _ = model(waveform.to(device))
            token_spans = aligner(emission[0], tokenizer(transcript))

        # Frames → seconds. emission time dim maps to the waveform length.
        num_frames = emission.size(1)
        ratio = waveform.size(1) / num_frames / sr

        out: list = [None] * len(words)
        for orig_i, spans in zip(align_idx, token_spans):
            if not spans:
                continue
            start = spans[0].start * ratio
            end = spans[-1].end * ratio
            score = sum(s.score * (s.end - s.start) for s in spans) / max(
                1, sum((s.end - s.start) for s in spans)
            )
            out[orig_i] = {"start": float(start), "end": float(end), "score": float(score)}
    except Exception as exc:  # noqa: BLE001
        _fail(f"alignment failed: {exc}")

    json.dump({"ok": True, "sample_rate": int(sr), "words": out}, sys.stdout)
    sys.stdout.flush()


if __name__ == "__main__":
    main()
