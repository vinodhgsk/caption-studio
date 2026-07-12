---
name: tts-provider
description: Text-to-Speech behind a pluggable provider — text+voice → audio clip added to the timeline. Local or cloud adapters; graceful degradation.
---
# tts-provider

## Interface
`listVoices() -> Voice[]`; `synthesize({text, voice, rate, pitch}) -> { audioPath, durationSec }`. Output written to bundle media/, added as an audio clip.

## Adapters
Local engine and a cloud adapter behind the same interface. If unavailable, surface a clear disabled state in the AI Tools panel.

## Alignment
Optionally return word timings so generated VO can drive captions too.

## Languages
Voices for the six supported languages — Tamil (default), Telugu, Malayalam, Kannada, Hindi, English. Restrict the voice picker to this set.
