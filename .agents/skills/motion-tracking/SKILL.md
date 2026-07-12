---
name: motion-tracking
description: Subject tracking that turns a target (face/object) into a per-frame transform path so text can stick to it. Pluggable provider; manual correction supported.
---
# motion-tracking

## Provider interface
`track(videoRef, target, range) -> { fps, path:[{t,x,y,scale,rotation,confidence}] }`. Implementations: local CV (lightweight) or cloud adapter.

## Attaching text
Write result to `clip.tracking.path`; compositor offsets the clip transform by the tracked transform at t. Blend with manual keyframes.

## Correction
Allow dropping manual anchor keyframes that override/blend low-confidence segments. Smooth jitter with a configurable filter.
