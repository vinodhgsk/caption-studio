/**
 * P9.6 — Frame-parity test suite for the transition engine.
 *
 * Validates that the preview compositor (evaluateTransition / preset fns) and
 * the FFmpeg export mapping (transitionToXfade) agree, and that the
 * setClipTransition reducer + command round-trip correctly.
 *
 * Pure TypeScript / vitest — no DOM, no Math.random in test code.
 */

import { describe, expect, it } from 'vitest'

// Side-effect import: registers the 4 built-in presets into the registry.
import './clipTransitionPresets'

import {
  IDENTITY_TRANSITION,
  evaluateTransition,
  getTransition,
  resolveTransition
} from './clipTransition'
import type { TransitionRef } from './clipTransition'
import { TRANSITION_CATALOG } from './clipTransitionPresets'
import { transitionToXfade } from './transitionExport'
import { setClipTransition, setClipTransitionCommand } from './clipTransitionCommand'

import type { Project } from '../../../shared/storage'
import type { Clip } from '../../../shared/project-schema'
import { defaultTransform } from '../../../shared/project-schema'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTextClip(id: string, overrides: Partial<Clip> = {}): Clip {
  return {
    id,
    mediaRef: '',
    in: 0,
    out: 4,
    start: 0,
    transform: defaultTransform(),
    text: { lines: ['Hello'] },
    ...overrides
  }
}

function makeProject(clips: Clip[]): Project {
  return {
    version: 1,
    id: 'proj-1',
    name: 'Test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: {
      fps: 30,
      resolution: [1920, 1080],
      aspect: '16:9',
      background: '#000000',
      language: 'en',
      languages: ['en']
    },
    storage: { location: 'local', root: '/tmp' },
    tracks: [{ id: 'track-1', type: 'text', clips }]
  }
}

const PROGRESS_STEPS = [0, 0.25, 0.5, 0.75, 1] as const

// ---------------------------------------------------------------------------
// 1. Registration — all 4 presets resolve
// ---------------------------------------------------------------------------

describe('Registration — all 4 presets resolve', () => {
  it('getTransition("dissolve") is defined', () => {
    expect(getTransition('dissolve')).toBeDefined()
  })

  it('getTransition("slide") is defined', () => {
    expect(getTransition('slide')).toBeDefined()
  })

  it('getTransition("zoom") is defined', () => {
    expect(getTransition('zoom')).toBeDefined()
  })

  it('getTransition("glitch") is defined', () => {
    expect(getTransition('glitch')).toBeDefined()
  })

  it('TRANSITION_CATALOG has exactly 4 entries', () => {
    expect(TRANSITION_CATALOG).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// 2. Sample at progress {0, 0.25, 0.5, 0.75, 1}
// ---------------------------------------------------------------------------

describe('Sample at progress steps — numeric validity', () => {
  const presetIds = ['dissolve', 'slide', 'zoom', 'glitch'] as const

  for (const presetId of presetIds) {
    describe(`preset: ${presetId}`, () => {
      for (const p of PROGRESS_STEPS) {
        it(`p=${p}: all fields are finite`, () => {
          const fn = getTransition(presetId)!
          const sample = fn({ progress: p, params: {} })
          for (const key of Object.keys(sample) as (keyof typeof sample)[]) {
            expect(
              Number.isFinite(sample[key]),
              `${presetId} p=${p} field "${key}" is not finite: ${sample[key]}`
            ).toBe(true)
          }
        })
      }

      // slide uses a wipe (both opacities stay at 1); opacity boundary checks
      // only apply to opacity-based presets (dissolve, zoom, glitch).
      if (presetId !== 'slide') {
        it('p=0: aOpacity near 1, bOpacity near 0 (incoming not visible at start)', () => {
          const fn = getTransition(presetId)!
          const s = fn({ progress: 0, params: {} })
          // Glitch has clean zones at p<0.05 so it also satisfies this
          expect(s.aOpacity).toBeCloseTo(1, 5)
          expect(s.bOpacity).toBeCloseTo(0, 5)
        })

        it('p=1: aOpacity near 0, bOpacity near 1 (outgoing gone at end)', () => {
          const fn = getTransition(presetId)!
          const s = fn({ progress: 1, params: {} })
          expect(s.aOpacity).toBeCloseTo(0, 5)
          expect(s.bOpacity).toBeCloseTo(1, 5)
        })
      }
    })
  }

  // For slide, confirm opacity stays at 1 for both clips (wipe — no fade).
  it('slide: aOpacity=1 and bOpacity=1 at all progress steps (directional wipe, no fade)', () => {
    const slide = getTransition('slide')!
    for (const p of PROGRESS_STEPS) {
      const s = slide({ progress: p, params: {} })
      expect(s.aOpacity).toBe(1)
      expect(s.bOpacity).toBe(1)
    }
  })

  it('dissolve: aOpacity + bOpacity ≈ 1 at all progress steps (crossfade constraint)', () => {
    const dissolve = getTransition('dissolve')!
    for (const p of PROGRESS_STEPS) {
      const s = dissolve({ progress: p, params: {} })
      expect(s.aOpacity + s.bOpacity).toBeCloseTo(1, 10)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. Settle-to-identity
// ---------------------------------------------------------------------------

describe('Settle-to-identity', () => {
  it('dissolve p=0: A fully visible, B invisible, no transforms', () => {
    const dissolve = getTransition('dissolve')!
    const s = dissolve({ progress: 0, params: {} })
    expect(s.aOpacity).toBe(1)
    expect(s.bOpacity).toBe(0)
    expect(s.aTx).toBe(0)
    expect(s.aTy).toBe(0)
    expect(s.aScale).toBe(1)
    expect(s.bTx).toBe(0)
    expect(s.bTy).toBe(0)
    expect(s.bScale).toBe(1)
  })

  it('dissolve p=1: A invisible, B fully visible, no transforms', () => {
    const dissolve = getTransition('dissolve')!
    const s = dissolve({ progress: 1, params: {} })
    expect(s.aOpacity).toBe(0)
    expect(s.bOpacity).toBe(1)
    expect(s.aTx).toBe(0)
    expect(s.aTy).toBe(0)
    expect(s.aScale).toBe(1)
    expect(s.bTx).toBe(0)
    expect(s.bTy).toBe(0)
    expect(s.bScale).toBe(1)
  })

  it('slide p=0: A at rest (aTx=0), B is off-screen (|bTx|>0 for default l direction)', () => {
    const slide = getTransition('slide')!
    const s = slide({ progress: 0, direction: 'l', params: {} })
    expect(s.aTx).toBeCloseTo(0, 10)
    expect(Math.abs(s.bTx)).toBeGreaterThan(0)
  })

  it('slide p=1: A is off-screen, B is at rest (aTx<0 exits left for l direction)', () => {
    const slide = getTransition('slide')!
    const s = slide({ progress: 1, direction: 'l', params: {} })
    // A has moved off-screen to the left
    expect(s.aTx).toBeLessThan(0)
    // B is now at rest (bTx=0)
    expect(s.bTx).toBe(0)
  })

  it('slide p=0 (right): A at rest (aTx=0), B off-screen (bTx<0)', () => {
    const slide = getTransition('slide')!
    const s = slide({ progress: 0, direction: 'r', params: {} })
    expect(s.aTx).toBe(0)
    expect(s.bTx).toBeLessThan(0)
  })

  it('slide p=1 (right): A off-screen (aTx>0), B at rest (bTx=0)', () => {
    const slide = getTransition('slide')!
    const s = slide({ progress: 1, direction: 'r', params: {} })
    expect(s.aTx).toBeGreaterThan(0)
    expect(s.bTx).toBeCloseTo(0, 10)
  })
})

// ---------------------------------------------------------------------------
// 4. Parity — two calls with same args produce identical output
// ---------------------------------------------------------------------------

describe('Parity — two calls with same args produce identical output', () => {
  const presetIds = ['dissolve', 'slide', 'zoom', 'glitch'] as const

  for (const presetId of presetIds) {
    for (const p of PROGRESS_STEPS) {
      it(`${presetId} p=${p}: two calls produce equal results`, () => {
        const fn = getTransition(presetId)!
        const phase = { progress: p, params: {} }
        expect(fn(phase)).toEqual(fn(phase))
      })
    }
  }
})

// ---------------------------------------------------------------------------
// 5. Seeded determinism for glitch
// ---------------------------------------------------------------------------

describe('Seeded determinism for glitch', () => {
  const glitch = () => getTransition('glitch')!

  it('same progress → same result (deterministic)', () => {
    const fn = glitch()
    const p = 0.5
    expect(fn({ progress: p, params: {} })).toEqual(fn({ progress: p, params: {} }))
  })

  it('same progress in the jitter zone → same result on repeated calls', () => {
    const fn = glitch()
    // 0.3 is in the chaotic middle zone (not in the clean edge zones)
    const p = 0.3
    expect(fn({ progress: p, params: {} })).toEqual(fn({ progress: p, params: {} }))
  })

  it('different progress values near 0.5 may yield different tx values (jitter active)', () => {
    const fn = glitch()
    // p=0.35 and p=0.65 land in different 1/30-second frame buckets
    const s1 = fn({ progress: 0.35, params: {} })
    const s2 = fn({ progress: 0.65, params: {} })
    // They are in the chaotic zone; we just confirm both are finite (determinism)
    expect(Number.isFinite(s1.aTx)).toBe(true)
    expect(Number.isFinite(s2.aTx)).toBe(true)
  })

  it('clean entry zone p<0.05: aTx=0, aTy=0 (no jitter at edges)', () => {
    const fn = glitch()
    const s = fn({ progress: 0.02, params: {} })
    expect(s.aTx).toBe(0)
    expect(s.aTy).toBe(0)
  })

  it('clean exit zone p>0.95: aTx=0, aTy=0 (no jitter at edges)', () => {
    const fn = glitch()
    const s = fn({ progress: 0.97, params: {} })
    expect(s.aTx).toBe(0)
    expect(s.aTy).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 6. Export parity — transitionToXfade mapping
// ---------------------------------------------------------------------------

describe('Export parity — transitionToXfade mapping', () => {
  it('dissolve → fade, duration preserved', () => {
    const spec = transitionToXfade({ presetId: 'dissolve', duration: 1, params: {} })
    expect(spec.filter).toBe('fade')
    expect(spec.duration).toBe(1)
  })

  it('slide direction=l → slideleft, duration preserved', () => {
    const spec = transitionToXfade({ presetId: 'slide', duration: 0.5, direction: 'l', params: {} })
    expect(spec.filter).toBe('slideleft')
    expect(spec.duration).toBe(0.5)
  })

  it('slide direction=r → slideright, duration preserved', () => {
    const spec = transitionToXfade({ presetId: 'slide', duration: 0.5, direction: 'r', params: {} })
    expect(spec.filter).toBe('slideright')
    expect(spec.duration).toBe(0.5)
  })

  it('slide direction=t → slideup, duration preserved', () => {
    const spec = transitionToXfade({ presetId: 'slide', duration: 0.5, direction: 't', params: {} })
    expect(spec.filter).toBe('slideup')
    expect(spec.duration).toBe(0.5)
  })

  it('slide direction=b → slidedown, duration preserved', () => {
    const spec = transitionToXfade({ presetId: 'slide', duration: 0.5, direction: 'b', params: {} })
    expect(spec.filter).toBe('slidedown')
    expect(spec.duration).toBe(0.5)
  })

  it('zoom → zoomin, duration preserved', () => {
    const spec = transitionToXfade({ presetId: 'zoom', duration: 1, params: {} })
    expect(spec.filter).toBe('zoomin')
    expect(spec.duration).toBe(1)
  })

  it('glitch → pixelize, duration preserved', () => {
    const spec = transitionToXfade({ presetId: 'glitch', duration: 0.8, params: {} })
    expect(spec.filter).toBe('pixelize')
    expect(spec.duration).toBe(0.8)
  })

  it('unknown preset falls back to fade', () => {
    const spec = transitionToXfade({ presetId: 'unknown-xyz', duration: 0.3, params: {} })
    expect(spec.filter).toBe('fade')
    expect(spec.duration).toBe(0.3)
  })
})

// ---------------------------------------------------------------------------
// 7. evaluateTransition — end-to-end
// ---------------------------------------------------------------------------

describe('evaluateTransition — end-to-end dissolve ref', () => {
  const ref: TransitionRef = { presetId: 'dissolve', duration: 1, params: {} }
  const clipAEnd = 5 // outgoing clip ends at t=5s; overlap window: [4, 5]

  it('t < windowStart (no overlap yet): aOpacity=1, bOpacity=0', () => {
    // t=3 is well before the window starts at t=4
    const s = evaluateTransition({ ref, clipAEnd, t: 3 })
    expect(s.aOpacity).toBe(1)
    expect(s.bOpacity).toBe(0)
  })

  it('t = windowStart (progress=0): aOpacity=1, bOpacity=0', () => {
    const s = evaluateTransition({ ref, clipAEnd, t: 4 })
    expect(s.aOpacity).toBeCloseTo(1, 10)
    expect(s.bOpacity).toBeCloseTo(0, 10)
  })

  it('t = clipAEnd - duration/2 (mid-overlap): 0 < aOpacity < 1', () => {
    // mid = 4 + 0.5 = 4.5 → progress = 0.5
    const s = evaluateTransition({ ref, clipAEnd, t: 4.5 })
    expect(s.aOpacity).toBeGreaterThan(0)
    expect(s.aOpacity).toBeLessThan(1)
  })

  it('t = clipAEnd (progress=1, end of overlap): aOpacity=0, bOpacity=1', () => {
    const s = evaluateTransition({ ref, clipAEnd, t: 5 })
    expect(s.aOpacity).toBeCloseTo(0, 10)
    expect(s.bOpacity).toBeCloseTo(1, 10)
  })

  it('t > clipAEnd (past overlap): aOpacity=0, bOpacity=1', () => {
    const s = evaluateTransition({ ref, clipAEnd, t: 6 })
    expect(s.aOpacity).toBeCloseTo(0, 10)
    expect(s.bOpacity).toBeCloseTo(1, 10)
  })

  it('unregistered preset falls back to IDENTITY_TRANSITION', () => {
    const badRef: TransitionRef = { presetId: 'nonexistent', duration: 1, params: {} }
    const s = evaluateTransition({ ref: badRef, clipAEnd, t: 4.5 })
    expect(s).toEqual(IDENTITY_TRANSITION)
  })

  it('progress clamps to [0,1] — no NaN even for t far outside the window', () => {
    const sLow = evaluateTransition({ ref, clipAEnd, t: -999 })
    const sHigh = evaluateTransition({ ref, clipAEnd, t: 9999 })
    expect(Number.isFinite(sLow.aOpacity)).toBe(true)
    expect(Number.isFinite(sHigh.bOpacity)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 8. setClipTransition command — undo/redo
// ---------------------------------------------------------------------------

describe('setClipTransition pure reducer', () => {
  it('sets clip.transitions.out for the targeted clip', () => {
    const p0 = makeProject([makeTextClip('c1')])
    const transitionValue = { presetId: 'dissolve', duration: 0.5, params: {} }
    const p1 = setClipTransition(p0, 'c1', 'out', transitionValue)
    expect(p1.tracks[0].clips[0].transitions?.out).toEqual(transitionValue)
  })

  it('sets clip.transitions.in for the targeted clip', () => {
    const p0 = makeProject([makeTextClip('c1')])
    const transitionValue = { presetId: 'slide', duration: 0.4, direction: 'l', params: {} }
    const p1 = setClipTransition(p0, 'c1', 'in', transitionValue)
    expect(p1.tracks[0].clips[0].transitions?.in).toEqual(transitionValue)
  })

  it('clearing with undefined removes the edge key', () => {
    const p0 = makeProject([
      makeTextClip('c1', {
        transitions: { out: { presetId: 'dissolve', duration: 0.5, params: {} } }
      })
    ])
    const p1 = setClipTransition(p0, 'c1', 'out', undefined)
    expect(p1.tracks[0].clips[0].transitions?.out).toBeUndefined()
  })

  it('clearing the last edge removes the transitions key entirely', () => {
    const p0 = makeProject([
      makeTextClip('c1', {
        transitions: { out: { presetId: 'dissolve', duration: 0.5, params: {} } }
      })
    ])
    const p1 = setClipTransition(p0, 'c1', 'out', undefined)
    expect(p1.tracks[0].clips[0].transitions).toBeUndefined()
  })

  it('is a no-op (returns same project) when clip id is not found', () => {
    const p0 = makeProject([makeTextClip('c1')])
    const p1 = setClipTransition(p0, 'nonexistent', 'out', { presetId: 'zoom', duration: 1, params: {} })
    // Should still return a project (same structure), and the original is untouched
    expect(p1.tracks[0].clips[0].transitions).toBeUndefined()
  })

  it('is immutable — original project is unchanged after setting a transition', () => {
    const p0 = makeProject([makeTextClip('c1')])
    setClipTransition(p0, 'c1', 'out', { presetId: 'glitch', duration: 0.4, params: {} })
    expect(p0.tracks[0].clips[0].transitions).toBeUndefined()
  })
})

describe('setClipTransitionCommand — undo/redo round-trips', () => {
  it('apply then invert restores original when starting with no transition', () => {
    const p0 = makeProject([makeTextClip('c1')])
    const cmd = setClipTransitionCommand(p0, {
      clipId: 'c1',
      edge: 'out',
      transition: { presetId: 'dissolve', duration: 0.5 }
    })
    const applied = cmd.apply(p0)
    expect(applied.tracks[0].clips[0].transitions?.out).toBeDefined()
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('apply sets the transition, invert restores prior transition', () => {
    const prior = { presetId: 'zoom', duration: 0.8, params: {} }
    const p0 = makeProject([makeTextClip('c1', { transitions: { out: prior } })])
    const cmd = setClipTransitionCommand(p0, {
      clipId: 'c1',
      edge: 'out',
      transition: { presetId: 'slide', duration: 0.4, direction: 'l' }
    })
    const applied = cmd.apply(p0)
    expect((applied.tracks[0].clips[0].transitions?.out as Record<string, unknown>)?.['presetId']).toBe('slide')
    const reverted = cmd.invert(applied)
    expect(reverted.tracks[0].clips[0].transitions?.out).toEqual(prior)
  })

  it('setting null clears the transition', () => {
    const p0 = makeProject([
      makeTextClip('c1', {
        transitions: { out: { presetId: 'glitch', duration: 0.4, params: {} } }
      })
    ])
    const cmd = setClipTransitionCommand(p0, {
      clipId: 'c1',
      edge: 'out',
      transition: null
    })
    const applied = cmd.apply(p0)
    expect(applied.tracks[0].clips[0].transitions?.out).toBeUndefined()
  })

  it('setting null then inverting restores the prior transition', () => {
    const prior = { presetId: 'glitch', duration: 0.4, params: {} }
    const p0 = makeProject([makeTextClip('c1', { transitions: { out: prior } })])
    const cmd = setClipTransitionCommand(p0, {
      clipId: 'c1',
      edge: 'out',
      transition: null
    })
    const applied = cmd.apply(p0)
    const reverted = cmd.invert(applied)
    expect(reverted.tracks[0].clips[0].transitions?.out).toEqual(prior)
  })

  it('invert restores BOTH edges (full transitions snapshot)', () => {
    const p0 = makeProject([
      makeTextClip('c1', {
        transitions: {
          in: { presetId: 'dissolve', duration: 0.3, params: {} },
          out: { presetId: 'zoom', duration: 0.5, params: {} }
        }
      })
    ])
    // Change only the 'out' edge
    const cmd = setClipTransitionCommand(p0, {
      clipId: 'c1',
      edge: 'out',
      transition: { presetId: 'glitch', duration: 0.4 }
    })
    const applied = cmd.apply(p0)
    // After apply, 'in' edge should still be intact
    expect(applied.tracks[0].clips[0].transitions?.in).toEqual({ presetId: 'dissolve', duration: 0.3, params: {} })
    // After invert, both edges are restored to original
    const reverted = cmd.invert(applied)
    expect(reverted).toEqual(p0)
  })

  it('command label is "Set transition" when transition is non-null', () => {
    const p0 = makeProject([makeTextClip('c1')])
    const cmd = setClipTransitionCommand(p0, {
      clipId: 'c1',
      edge: 'out',
      transition: { presetId: 'dissolve', duration: 0.5 }
    })
    expect(cmd.label).toBe('Set transition')
  })

  it('command label is "Clear transition" when transition is null', () => {
    const p0 = makeProject([makeTextClip('c1')])
    const cmd = setClipTransitionCommand(p0, {
      clipId: 'c1',
      edge: 'out',
      transition: null
    })
    expect(cmd.label).toBe('Clear transition')
  })
})

// ---------------------------------------------------------------------------
// 9. resolveTransition — typed parse of raw bag
// ---------------------------------------------------------------------------

describe('resolveTransition — raw bag parser', () => {
  it('returns undefined for undefined input', () => {
    expect(resolveTransition(undefined)).toBeUndefined()
  })

  it('returns undefined when presetId is absent', () => {
    expect(resolveTransition({ duration: 1, params: {} })).toBeUndefined()
  })

  it('returns undefined when presetId is empty string', () => {
    expect(resolveTransition({ presetId: '', duration: 1, params: {} })).toBeUndefined()
  })

  it('parses a valid bag to a TransitionRef', () => {
    const raw = { presetId: 'dissolve', duration: 0.5, params: {} }
    const ref = resolveTransition(raw)
    expect(ref).toBeDefined()
    expect(ref?.presetId).toBe('dissolve')
    expect(ref?.duration).toBe(0.5)
    expect(ref?.direction).toBeUndefined()
  })

  it('parses direction when valid', () => {
    const raw = { presetId: 'slide', duration: 0.4, direction: 'l', params: {} }
    const ref = resolveTransition(raw)
    expect(ref?.direction).toBe('l')
  })

  it('ignores invalid direction string', () => {
    const raw = { presetId: 'slide', duration: 0.4, direction: 'x', params: {} }
    const ref = resolveTransition(raw)
    expect(ref?.direction).toBeUndefined()
  })

  it('defaults duration to 1 when absent or non-positive', () => {
    const ref1 = resolveTransition({ presetId: 'dissolve', params: {} })
    expect(ref1?.duration).toBe(1)
    const ref2 = resolveTransition({ presetId: 'dissolve', duration: 0, params: {} })
    expect(ref2?.duration).toBe(1)
    const ref3 = resolveTransition({ presetId: 'dissolve', duration: -1, params: {} })
    expect(ref3?.duration).toBe(1)
  })

  it('defaults params to empty object when absent or invalid', () => {
    const ref = resolveTransition({ presetId: 'zoom' })
    expect(ref?.params).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// 10. IDENTITY_TRANSITION constant
// ---------------------------------------------------------------------------

describe('IDENTITY_TRANSITION constant', () => {
  it('has the correct identity values', () => {
    expect(IDENTITY_TRANSITION).toEqual({
      aOpacity: 1,
      aTx: 0,
      aTy: 0,
      aScale: 1,
      bOpacity: 0,
      bTx: 0,
      bTy: 0,
      bScale: 1
    })
  })
})
