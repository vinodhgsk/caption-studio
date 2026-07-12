---
name: ffmpeg-export
description: Build FFmpeg jobs from the timeline — filtergraphs for clips/transforms/transitions/overlays, audio mix, progress IPC, and cancel. Use for audio normalize and final export.
---
# ffmpeg-export

## Audio normalize (auto-caption)
`ffmpeg -i in.mp3 -ac 1 -ar 16000 out.wav`.

## Export job
Serialize timeline → inputs + filtergraph: trim/scale/rotate/opacity per clip, `xfade`/custom for transitions, overlay baked text frames (from text-render headless) for parity, `amix` for audio, then encode (h264/aac mp4 default).

## Progress + cancel
Parse `-progress pipe:1`; emit progress events over IPC; support cancel by killing the child process and cleaning temp files.
