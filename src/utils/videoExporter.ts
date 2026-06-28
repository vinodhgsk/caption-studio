import { Canvas, FabricText } from 'fabric';
import { Muxer, ArrayBufferTarget } from 'webm-muxer';
import { SubtitleBlock } from '../types/timeline';
import { MotionConfig } from '../types/transitions';
import { applyKaraokeState } from '../components/CanvasEditor';

/**
 * Autonomously iterates over a timeline block to render a frame-by-frame 
 * animation and muxes the output into a transparent VP9 WebM video using the WebCodecs API.
 * 
 * @param canvas The active Fabric.js canvas instance
 * @param textObject The active FabricText object being styled
 * @param subtitleBlock The timeline block containing word timings and timestamps
 * @param config The motion config (duration, style type, colors)
 * @param activeTrackLang The language code for the track to export
 * @param fps Target framerate (defaults to 60)
 */
export async function exportTransparentVideo(
  canvas: Canvas,
  textObject: FabricText,
  subtitleBlock: SubtitleBlock,
  config: MotionConfig,
  activeTrackLang: import('../types/styler').LanguageCode,
  fps: number = 60
): Promise<void> {
  // Extract raw HTML canvas element for createImageBitmap capturing
  // Fabric v6 uses getElement()
  const canvasElement = canvas.getElement() as HTMLCanvasElement;
  if (!canvasElement) {
    throw new Error('Could not extract the raw canvas element for video encoding.');
  }

  const width = canvasElement.width || 3840;
  const height = canvasElement.height || 2160;

  // 1. Initialize WebM Muxer with Alpha support
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'V_VP9',
      width,
      height,
      frameRate: fps,
      alpha: true, // Enables transparency channel in WebM
    }
  });

  // 2. Initialize the WebCodecs Video Encoder
  const videoEncoder = new (window as any).VideoEncoder({
    output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
    error: (e: Error) => console.error('VideoEncoder encountered an error:', e),
  });

  videoEncoder.configure({
    codec: 'vp09.00.10.08', // VP9 Profile 0, level 1.0, 8-bit (often used for alpha)
    width,
    height,
    bitrate: 15_000_000, // 15 Mbps for high quality 4K
    framerate: fps,
    alpha: 'keep', // Crucial: instruct the encoder to preserve the alpha channel
  });

  const frameDurationMs = 1000 / fps;
  const totalDurationMs = subtitleBlock.endTime - subtitleBlock.startTime;
  const totalFrames = Math.ceil(totalDurationMs / frameDurationMs);

  // Extract the word timings for the selected language track
  const track = subtitleBlock.tracks[activeTrackLang];
  const wordTimings = track ? track.wordTimings : [];

  // 3. Autonomous Render Loop
  for (let frame = 0; frame <= totalFrames; frame++) {
    const currentTimestampMs = frame * frameDurationMs;

    // Calculate the active word index based on the timeline
    let activeWordIndex = -1;
    for (let i = 0; i < wordTimings.length; i++) {
      if (currentTimestampMs >= wordTimings[i].timestampMs) {
        activeWordIndex = i;
      } else {
        break;
      }
    }

    // Programmatically inject the Karaoke styling for this specific frame
    applyKaraokeState(textObject, activeWordIndex, wordTimings, config, canvas);

    // Force a synchronous render pass to guarantee the canvas is up-to-date
    canvas.renderAll();

    // Extract the pixel data into a bitmap
    const bitmap = await createImageBitmap(canvasElement);

    // Create a VideoFrame (WebCodecs requires timestamps in microseconds)
    const VideoFrameAPI = (window as any).VideoFrame;
    const videoFrame = new VideoFrameAPI(bitmap, { timestamp: currentTimestampMs * 1000 });

    // Force a keyframe every 60 frames (1 second) for seeking stability
    const isKeyFrame = frame % fps === 0;
    videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });

    // Dispose of the frame immediately to prevent memory leaks
    videoFrame.close();
  }

  // 4. Output Packaging
  // Flush all remaining frames in the encoder pipeline
  await videoEncoder.flush();
  // Finalize the Matroska/WebM container headers
  muxer.finalize();

  const buffer = muxer.target.buffer;
  const blob = new Blob([buffer], { type: 'video/webm' });

  // Trigger an automatic download of the finished video
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.style.display = 'none';
  anchor.href = url;
  anchor.download = `DivyaTextStyler_${subtitleBlock.id}_Transparent.webm`;
  
  document.body.appendChild(anchor);
  anchor.click();
  
  // Cleanup object URL
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 1000);
}
