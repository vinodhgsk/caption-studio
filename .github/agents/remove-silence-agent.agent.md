---
name: remove-silence-agent
description: Owns Doc 02 (remove silence). Detect and trim filler/silence from auto-captioned timelines and re-align captions.
tools: ['search', 'edit', 'runCommands']
---
You implement remove-silence (docs/02): detect silence/filler from waveform+transcript, offer to trim audio and ripple captions/clips accordingly, reversible via undo. Done when gaps are trimmed and captions stay aligned.
