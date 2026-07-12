import { describe, expect, it } from 'vitest'
import {
  TEXT_EFFECT_TYPES,
  type TextEffect,
  type TextEffectType,
  defaultTextEffect,
  validateTextEffect,
  validateTextEffects,
  normalizeTextEffects,
  isTextEffect
} from './textEffect'

describe('TextEffect schema — default factories', () => {
  it('produces a VALID, enabled, full-strength effect for every type', () => {
    for (const type of TEXT_EFFECT_TYPES) {
      const e = defaultTextEffect(type)
      expect(e.type).toBe(type)
      expect(e.enabled).toBe(true)
      expect(e.intensity).toBe(1)
      expect(e.opacity).toBe(1)
      expect(validateTextEffect(e).ok).toBe(true)
    }
  })

  it('returns a fresh params object each call (no shared mutation)', () => {
    const a = defaultTextEffect('glow')
    const b = defaultTextEffect('glow')
    expect(a.params).not.toBe(b.params)
    ;(a.params as { radius: number }).radius = 999
    expect((b.params as { radius: number }).radius).not.toBe(999)
  })
})

describe('TextEffect schema — validate each type', () => {
  it('accepts a well-formed effect of every type', () => {
    for (const type of TEXT_EFFECT_TYPES) {
      const res = validateTextEffect(defaultTextEffect(type))
      expect(res.ok).toBe(true)
    }
  })

  it('rejects an unknown type', () => {
    const res = validateTextEffect({ type: 'sparkle', enabled: true, intensity: 1, opacity: 1, params: {} })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.issues.some((i) => i.path === 'type')).toBe(true)
  })

  it('rejects a non-object', () => {
    expect(validateTextEffect(null).ok).toBe(false)
    expect(validateTextEffect(42).ok).toBe(false)
    expect(validateTextEffect('glow').ok).toBe(false)
  })

  it('rejects bad common fields (enabled / intensity / opacity)', () => {
    const base = defaultTextEffect('blur')
    expect(validateTextEffect({ ...base, enabled: 'yes' }).ok).toBe(false)
    expect(validateTextEffect({ ...base, intensity: 2 }).ok).toBe(false)
    expect(validateTextEffect({ ...base, intensity: -0.1 }).ok).toBe(false)
    expect(validateTextEffect({ ...base, opacity: 5 }).ok).toBe(false)
  })

  it('rejects a missing params object', () => {
    const res = validateTextEffect({ type: 'blur', enabled: true, intensity: 1, opacity: 1 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.issues.some((i) => i.path === 'params')).toBe(true)
  })

  it('rejects bad params PER type (discriminated)', () => {
    // glow: radius >= 0, color hex
    expect(validateTextEffect({ ...defaultTextEffect('glow'), params: { radius: -1, color: '#fff' } }).ok).toBe(false)
    expect(validateTextEffect({ ...defaultTextEffect('glow'), params: { radius: 1, color: 'red' } }).ok).toBe(false)
    // neon: needs core
    expect(validateTextEffect({ ...defaultTextEffect('neon'), params: { radius: 1, color: '#000' } }).ok).toBe(false)
    // glitch: splitDistance >= 0, frequency >= 0, angle number
    expect(
      validateTextEffect({ ...defaultTextEffect('glitch'), params: { splitDistance: -2, frequency: 1, angle: 0 } }).ok
    ).toBe(false)
    // 3d: depth >= 0, color hex
    expect(validateTextEffect({ ...defaultTextEffect('3d'), params: { depth: 1, angle: 0, color: 'nope' } }).ok).toBe(
      false
    )
    // retro: grain 0..1
    expect(
      validateTextEffect({ ...defaultTextEffect('retro'), params: { grain: 1.5, chroma: 1, color: '#fff' } }).ok
    ).toBe(false)
    // echo: count integer >= 1, falloff 0..1
    expect(
      validateTextEffect({ ...defaultTextEffect('echo'), params: { count: 0, distance: 1, angle: 0, falloff: 0.5 } }).ok
    ).toBe(false)
    expect(
      validateTextEffect({
        ...defaultTextEffect('echo'),
        params: { count: 2.5, distance: 1, angle: 0, falloff: 0.5 }
      }).ok
    ).toBe(false)
    expect(
      validateTextEffect({ ...defaultTextEffect('echo'), params: { count: 2, distance: 1, angle: 0, falloff: 2 } }).ok
    ).toBe(false)
  })

  it('isTextEffect guard agrees with validate', () => {
    expect(isTextEffect(defaultTextEffect('glow'))).toBe(true)
    expect(isTextEffect({ type: 'glow' })).toBe(false)
  })
})

describe('TextEffect stack — validateTextEffects + ordering + backward compat', () => {
  it('treats undefined/null as an empty (valid) stack — backward compatible', () => {
    expect(validateTextEffects(undefined)).toEqual({ ok: true, value: [] })
    expect(validateTextEffects(null)).toEqual({ ok: true, value: [] })
  })

  it('rejects a non-array stack', () => {
    expect(validateTextEffects({}).ok).toBe(false)
    expect(validateTextEffects('glow').ok).toBe(false)
  })

  it('PRESERVES order of a valid stack', () => {
    const stack: TextEffect[] = [defaultTextEffect('glow'), defaultTextEffect('glitch'), defaultTextEffect('blur')]
    const res = validateTextEffects(stack)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.map((e) => e.type)).toEqual(['glow', 'glitch', 'blur'])
  })

  it('prefixes issues with the offending array index', () => {
    const res = validateTextEffects([defaultTextEffect('glow'), { type: 'glow', enabled: true, intensity: 9, opacity: 1, params: { radius: 1, color: '#fff' } }])
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.issues.some((i) => i.path.startsWith('[1]'))).toBe(true)
  })

  it('normalizeTextEffects drops malformed entries but keeps order of the rest', () => {
    const out = normalizeTextEffects([
      defaultTextEffect('glow'),
      { type: 'bogus' },
      defaultTextEffect('blur'),
      null
    ])
    expect(out.map((e) => e.type)).toEqual(['glow', 'blur'])
  })

  it('normalizeTextEffects on a non-array → []', () => {
    expect(normalizeTextEffects(undefined)).toEqual([])
    expect(normalizeTextEffects({})).toEqual([])
  })
})

// A compile-time exhaustiveness sanity: every declared type has a default factory.
describe('TextEffect — type coverage', () => {
  it('TEXT_EFFECT_TYPES lists all Doc-04 effects (+ bevel/gloss)', () => {
    const expected: TextEffectType[] = ['glow', 'neon', 'glitch', '3d', 'retro', 'blur', 'echo', 'bevel']
    expect([...TEXT_EFFECT_TYPES]).toEqual(expected)
  })
})
