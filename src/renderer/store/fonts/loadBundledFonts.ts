/**
 * Register the app-bundled font faces into the renderer's `document.fonts` (P6.x).
 *
 * The canvas (preview AND the caption-overlay export) can only shape a family
 * that lives in `document.fonts`; the bundled `resources/fonts` TTFs are not
 * force-loaded there otherwise, so Indic text (and the Baloo Thambi 2 default
 * caption face) would fall back to whatever the OS has. This fetches the raw
 * bytes from main (`fonts:loadBundled`) and adds a `FontFace` per face, so
 * preview == overlay-export == the presets, deterministically, on any machine.
 *
 * Idempotent + best-effort: safe to call once at startup; failures (fonts not
 * downloaded, IPC error) are swallowed so the app still boots.
 */

let loaded = false

export async function loadBundledFonts(): Promise<void> {
  if (loaded) return
  loaded = true
  if (typeof document === 'undefined' || document.fonts === undefined) return
  try {
    const res = await window.api.invoke('fonts:loadBundled', undefined)
    if (!res.ok) return
    for (const face of res.data.faces) {
      try {
        // Copy into a fresh ArrayBuffer (FontFace needs a real ArrayBuffer, not a
        // Node Buffer view that crossed IPC).
        const bytes = face.data instanceof Uint8Array ? face.data : new Uint8Array(face.data)
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        const ff = new FontFace(face.family, buf as ArrayBuffer, {
          weight: face.weight,
          style: face.style
        })
        await ff.load()
        document.fonts.add(ff)
      } catch {
        // Skip a single bad face; keep loading the rest.
      }
    }
  } catch {
    // Ignore — the canvas falls back to system fonts.
  }
}
