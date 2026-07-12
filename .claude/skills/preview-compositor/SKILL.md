---
name: preview-compositor
description: Canvas/WebGL compositing rules for the preview — layer order, transforms, the per-frame render loop, and parity requirements with FFmpeg export. Use for any preview rendering.
---
# preview-compositor

## Render loop
At playhead t: collect visible clips (start ≤ t < start+dur) sorted by track then `transform.z`. For each, evaluate keyframes + animation → transform, then draw.

## Layer/draw order per text clip
background(clip) → decoration.background → shadow → fill → stroke(outer→inner) → effects(stack order) → animation transform applied to the whole group.

## Transforms
Apply `transform` (x,y,scale,rotation,flipH,flipV,opacity) in canvas space normalized to project resolution, then scale to the preview viewport.

## Parity contract
The same text pipeline (text-render) MUST be reusable headless so export produces identical frames. No preview-only shortcuts. render-parity-agent validates.
