---
name: keyframe-engine
description: Interpolation and easing for keyframes and motion paths — sample any animatable prop at a given time with per-segment easing. Use for keyframes, motion paths, and animation evaluators.
---
# keyframe-engine

## Model
Keyframe `{t, props:{x,y,scale,rotation,opacity,...}, ease}`. Sorted by t. `evalAt(t)` finds the bracketing pair, normalizes progress, applies ease, lerps each prop.

## Easing
Named eases (linear, easeIn/Out/InOut, cubic-bezier(p1,p2,p3,p4), spring). Provide a registry `ease(name, p) -> p'`.

## Motion paths
Sample a drawn path (array of points or bezier) into a parametric function `pathAt(u)→{x,y}`; map clip-local progress → u. Optionally bake to keyframes.

## Determinism
Pure functions, no time-of-day state. Same inputs → same output (testable).
