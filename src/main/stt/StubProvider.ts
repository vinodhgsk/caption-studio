/**
 * No-op STT provider (P4.4). A deterministic placeholder that satisfies the
 * {@link SttProvider} contract so the IPC channel + registry can be wired and
 * tested end-to-end BEFORE the real whisper.cpp integration (P4.5) lands.
 *
 * It does NOT read the WAV or spawn anything — it returns an empty word list
 * with the resolved language (the pinned `opts.language`, else the Tamil
 * fallback). This keeps the result shape stable and deterministic for unit
 * tests while signalling "no transcription happened yet" (zero words).
 *
 * NO electron / node imports — kept pure so it is trivially unit-testable.
 */
import {
  DEFAULT_LANGUAGE,
  type SttProvider,
  type Transcript,
  type TranscribeOptions
} from '../../shared/stt'

export class StubSttProvider implements SttProvider {
  readonly id = 'stub'

  async transcribe(
    _bundlePath: string,
    _wavRef: string,
    opts?: TranscribeOptions
  ): Promise<Transcript> {
    return {
      language: opts?.language ?? DEFAULT_LANGUAGE,
      words: []
    }
  }
}
