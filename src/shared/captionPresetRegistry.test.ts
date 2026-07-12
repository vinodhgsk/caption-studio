import { afterEach, describe, expect, it } from 'vitest'
import { validateCaptionPreset, type CaptionPreset } from './captionPreset'
import {
  BUILT_IN_PRESET_IDS,
  DEFAULT_APPLIED_CAPTION_PRESET_ID,
  PRESET_BHAKTHI_GOLD,
  PRESET_BOUNCE,
  PRESET_GRAND_TEMPLE_GOLD,
  PRESET_KARAOKE_HIGHLIGHT,
  PRESET_POP_BY_WORD,
  PRESET_SARVAM_BHAKTI_GOLD,
  PRESET_SARVAM_BHAKTI_GOLD_3D,
  PRESET_TIKTOK_CLASSIC,
  PRESET_TYPEWRITER,
  getCaptionPreset,
  isBuiltInPreset,
  listCaptionPresets,
  registerCaptionPreset,
  unregisterCaptionPreset
} from './captionPresetRegistry'

/** A minimal valid extra preset to exercise the extension hook. */
function extraPreset(id = 'my-custom'): CaptionPreset {
  return {
    id,
    displayName: 'My Custom',
    category: 'caption',
    font: {
      family: 'Noto Sans Tamil',
      size: 44,
      weight: 'bold',
      italic: false,
      letterSpacing: 0,
      lineHeight: 1.2
    },
    fill: { type: 'solid', value: '#ffffff', opacity: 1 },
    animation: { reveal: { mode: 'word', staggerSec: 0, easing: 'easeOut' } },
    layout: { anchor: 'lower-third', safeMargin: true, maxLines: 2 },
    highlight: { enabled: true, activeColor: '#ffe600', activeScale: 1.1, style: 'wholeWord' }
  }
}

// Keep the global registry clean between tests (built-ins survive; extras removed).
afterEach(() => {
  for (const p of listCaptionPresets()) {
    if (!isBuiltInPreset(p.id)) unregisterCaptionPreset(p.id)
  }
})

describe('built-in preset registry', () => {
  it('ships the built-ins in gallery order with distinct ids (Sarvam Bhakti Gold 3D leads as the default)', () => {
    expect([...BUILT_IN_PRESET_IDS]).toEqual([
      PRESET_SARVAM_BHAKTI_GOLD_3D,
      PRESET_SARVAM_BHAKTI_GOLD,
      PRESET_TIKTOK_CLASSIC,
      PRESET_KARAOKE_HIGHLIGHT,
      PRESET_POP_BY_WORD,
      PRESET_BOUNCE,
      PRESET_TYPEWRITER,
      PRESET_BHAKTHI_GOLD,
      PRESET_GRAND_TEMPLE_GOLD
    ])
    expect(new Set(BUILT_IN_PRESET_IDS).size).toBe(9)
  })

  it('DEFAULT_APPLIED_CAPTION_PRESET_ID is Sarvam Bhakti Gold 3D — the signature gold default', () => {
    expect(DEFAULT_APPLIED_CAPTION_PRESET_ID).toBe(PRESET_SARVAM_BHAKTI_GOLD_3D)
    const p = getCaptionPreset(DEFAULT_APPLIED_CAPTION_PRESET_ID)!
    expect(p).toBeDefined()
    // Signature gold: top→bottom (90°) gradient fill that flips per sung word,
    // word-by-word (whole-word) highlight.
    expect(p.fill.type).toBe('gradient')
    expect(p.fill.angle).toBe(90)
    expect(p.fill.perWord).toBe(true)
    expect(p.highlight.enabled).toBe(true)
    expect(p.highlight.style).toBe('wholeWord')
    // A 3D extrusion wall gives the raised-letter depth.
    expect(p.effects?.some((e) => e.type === '3d')).toBe(true)
  })

  it('every built-in passes validateCaptionPreset', () => {
    for (const id of BUILT_IN_PRESET_IDS) {
      const preset = getCaptionPreset(id)
      expect(preset, `${id} should resolve`).toBeDefined()
      const result = validateCaptionPreset(preset)
      expect(result.ok, `${id} should validate: ${result.ok ? '' : JSON.stringify(result.issues)}`).toBe(true)
      expect(preset!.id).toBe(id)
    }
  })

  it('built-ins use an Indic-capable default font (Tamil) so Tamil/Indic shape', () => {
    for (const id of BUILT_IN_PRESET_IDS) {
      const p = getCaptionPreset(id)!
      const families = [p.font.family, ...(p.font.fallback ?? [])].join(' ').toLowerCase()
      expect(families, `${id} should reference a Tamil-capable family`).toContain('tamil')
    }
  })

  it('built-ins are meaningfully distinct across fill/highlight/animation (visible thumbnails)', () => {
    const all = BUILT_IN_PRESET_IDS.map((id) => getCaptionPreset(id)!)
    // Reveal modes span none/word/character so P5.5 reveal differs per preset.
    const revealModes = all.map((p) => p.animation.reveal?.mode)
    expect(new Set(revealModes).size).toBeGreaterThanOrEqual(3)
    // Highlight styles include both wipe (karaoke) and wholeWord (pop/tiktok).
    const hlStyles = new Set(all.map((p) => p.highlight.style))
    expect(hlStyles.has('wipe')).toBe(true)
    expect(hlStyles.has('wholeWord')).toBe(true)
    // At least one gradient fill (Bounce) exists alongside solid fills.
    expect(all.some((p) => p.fill.type === 'gradient')).toBe(true)
    expect(all.some((p) => p.fill.type === 'solid')).toBe(true)
  })

  it('Karaoke Highlight wipes the active word (style:wipe, no per-word reveal)', () => {
    const p = getCaptionPreset(PRESET_KARAOKE_HIGHLIGHT)!
    expect(p.highlight.enabled).toBe(true)
    expect(p.highlight.style).toBe('wipe')
    expect(p.animation.reveal?.mode).toBe('none')
  })

  it('Pop by Word reveals word-by-word and scales the active word up', () => {
    const p = getCaptionPreset(PRESET_POP_BY_WORD)!
    expect(p.animation.reveal?.mode).toBe('word')
    expect(p.highlight.style).toBe('wholeWord')
    expect(p.highlight.activeScale).toBeGreaterThan(1)
  })

  it('Bounce uses a bounce-y entrance (spring easing)', () => {
    const p = getCaptionPreset(PRESET_BOUNCE)!
    expect(p.animation.in?.preset).toBe('bounce')
    expect(p.animation.in?.easing).toBe('spring')
  })

  it('Typewriter reveals by character (grapheme cluster) and has no active flip', () => {
    const p = getCaptionPreset(PRESET_TYPEWRITER)!
    expect(p.animation.reveal?.mode).toBe('character')
    expect(p.animation.reveal!.staggerSec).toBeGreaterThan(0)
    expect(p.highlight.enabled).toBe(false)
  })

  it('TikTok Classic is bold, high-contrast, with whole-word active highlight', () => {
    const p = getCaptionPreset(PRESET_TIKTOK_CLASSIC)!
    expect(p.highlight.style).toBe('wholeWord')
    expect(p.highlight.enabled).toBe(true)
    expect(p.stroke?.length ?? 0).toBeGreaterThan(0)
  })
})

describe('registry API', () => {
  it('listCaptionPresets returns all five built-ins', () => {
    const ids = listCaptionPresets().map((p) => p.id)
    expect(ids).toEqual([...BUILT_IN_PRESET_IDS])
  })

  it('getCaptionPreset resolves a known id and returns undefined for unknown', () => {
    expect(getCaptionPreset(PRESET_TIKTOK_CLASSIC)?.id).toBe(PRESET_TIKTOK_CLASSIC)
    expect(getCaptionPreset('does-not-exist')).toBeUndefined()
  })

  it('built-ins are immutable — mutating a returned preset does not affect the registry', () => {
    const a = getCaptionPreset(PRESET_TIKTOK_CLASSIC)!
    a.displayName = 'MUTATED'
    a.font.size = 999
    const b = getCaptionPreset(PRESET_TIKTOK_CLASSIC)!
    expect(b.displayName).not.toBe('MUTATED')
    expect(b.font.size).not.toBe(999)
    // distinct object references each read
    expect(a).not.toBe(b)
  })

  it('registerCaptionPreset adds a valid preset, then list/get see it', () => {
    const res = registerCaptionPreset(extraPreset('hook-ok'))
    expect(res.ok).toBe(true)
    expect(getCaptionPreset('hook-ok')?.displayName).toBe('My Custom')
    const ids = listCaptionPresets().map((p) => p.id)
    expect(ids).toEqual([...BUILT_IN_PRESET_IDS, 'hook-ok'])
  })

  it('registerCaptionPreset rejects a malformed preset', () => {
    const res = registerCaptionPreset({ id: 'broken' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('invalid')
    expect(getCaptionPreset('broken')).toBeUndefined()
  })

  it('registerCaptionPreset rejects a duplicate registered id', () => {
    expect(registerCaptionPreset(extraPreset('dupe')).ok).toBe(true)
    const second = registerCaptionPreset(extraPreset('dupe'))
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe('duplicate-id')
  })

  it('registerCaptionPreset rejects collision with a built-in id', () => {
    const res = registerCaptionPreset(extraPreset(PRESET_TIKTOK_CLASSIC))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('built-in-id')
    // the built-in is untouched
    expect(getCaptionPreset(PRESET_TIKTOK_CLASSIC)?.displayName).toBe('TikTok Classic')
  })

  it('stored registered presets are immutable from the input/output references', () => {
    const input = extraPreset('iso')
    registerCaptionPreset(input)
    input.displayName = 'CHANGED-INPUT'
    expect(getCaptionPreset('iso')?.displayName).toBe('My Custom')
    const out = getCaptionPreset('iso')!
    out.displayName = 'CHANGED-OUTPUT'
    expect(getCaptionPreset('iso')?.displayName).toBe('My Custom')
  })

  it('isBuiltInPreset distinguishes built-ins from registered presets', () => {
    expect(isBuiltInPreset(PRESET_BOUNCE)).toBe(true)
    registerCaptionPreset(extraPreset('not-built-in'))
    expect(isBuiltInPreset('not-built-in')).toBe(false)
  })
})
