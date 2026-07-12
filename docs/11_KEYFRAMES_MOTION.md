# 11 — Keyframes & Motion

**Phase:** 8 · **Owning agents:** `keyframe-motion-agent`, `motion-tracking-agent`, `beat-sync-agent` · **Skills:** `keyframe-engine`, `motion-tracking`, `timeline-engine`

## Goal
Implement keyframe animation (position/scale/rotation/opacity at any timeline point), custom motion-path drawing, AI motion tracking (text sticks to a moving subject), and beat-sync (snap text in/out to audio beats).

## Dependencies
- Doc 01 (timeline/preview/transform), Doc 02 (audio for beats), `keyframe-engine`, `motion-tracking`.

## Data model touchpoints
- `clips[].keyframes = [{t, props:{x,y,scale,rotation,opacity}, ease}]`; `clips[].tracking = {enabled,target,path[]}`; beat markers derived from audio.

## UI/UX spec
Keyframe lane per clip on the timeline: add/move/delete keyframes, diamond markers, easing per segment. "Draw motion path" tool on the canvas. Motion-tracking panel: pick target (face/object), track, attach text. Beat-sync: detect beats, snap selected clips' start/out to nearest beats.

## Build prompts
```
PROMPT 11.1 — Implement keyframes (keyframe-motion-agent + keyframe-engine): add/edit/delete keyframes on x/y/scale/rotation/opacity; interpolate with per-segment easing; render on the keyframe lane and drive the preview transform.
```
```
PROMPT 11.2 — Implement custom motion path: draw a path on canvas, sample it into keyframes (or evaluate continuously), so the clip follows the path over its duration.
```
```
PROMPT 11.3 — Implement AI motion tracking behind a tracking provider: select a target, produce per-frame transforms (tracking.path), and attach the text clip so it follows the subject. Allow manual correction.
```
```
PROMPT 11.4 — Implement beat-sync (beat-sync-agent): detect beats from the audio track; provide snap-to-beat for clip start/out and for caption appearance.
```

## Acceptance criteria
- Keyframes interpolate smoothly with easing and persist.
- Motion path makes a clip follow the drawn curve.
- Tracked text follows the subject; correctable.
- Beat-sync snaps clips/captions to detected beats.

## Test notes
Assert interpolation values at sampled times match easing. Verify path sampling reproduces the drawn curve. Test tracking on a sample clip with known motion. Validate detected beats against a metronome track.
