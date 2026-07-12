import { describe, expect, it } from 'vitest'
import {
  EFFECT_PARAM_META,
  addEffect,
  clamp01,
  deriveEffects,
  effectTypeLabel,
  galleryItems,
  moveEffect,
  moveEffectDown,
  moveEffectUp,
  removeEffect,
  setEffectEnabled,
  setEffectIntensity,
  setEffectOpacity,
  setEffectParam
} from './effectsPanelState'
import {
  TEXT_EFFECT_TYPES,
  defaultTextEffect,
  normalizeTextEffects,
  type TextEffect
} from '../../../shared/textEffect'

describe('deriveEffects', () => {
  it('normalizes an open bag into the typed ordered stack', () => {
    const bag: unknown[] = [defaultTextEffect('glow'), { type: 'bogus' }, defaultTextEffect('blur')]
    const out = deriveEffects(bag)
    expect(out.map((e) => e.type)).toEqual(['glow', 'blur']) // malformed dropped, order kept
  })
  it('is empty for undefined / non-array', () => {
    expect(deriveEffects(undefined)).toEqual([])
    expect(deriveEffects('nope' as unknown)).toEqual([])
  })
})

describe('addEffect', () => {
  it('APPENDS a defaultTextEffect(type) at the end without mutating', () => {
    const before: TextEffect[] = [defaultTextEffect('glow')]
    const after = addEffect(before, 'neon')
    expect(after).toHaveLength(2)
    expect(after[1]).toEqual(defaultTextEffect('neon'))
    expect(before).toHaveLength(1) // immutable
  })
  it('appends the exact default factory output for every type', () => {
    for (const t of TEXT_EFFECT_TYPES) {
      const added = addEffect([], t)
      expect(added[0]).toEqual(defaultTextEffect(t))
    }
  })
})

describe('removeEffect', () => {
  it('removes by index and preserves the others in order', () => {
    const list = [defaultTextEffect('glow'), defaultTextEffect('neon'), defaultTextEffect('blur')]
    const out = removeEffect(list, 1)
    expect(out.map((e) => e.type)).toEqual(['glow', 'blur'])
    expect(list).toHaveLength(3) // immutable
  })
  it('returns a fresh copy on out-of-range index', () => {
    const list = [defaultTextEffect('glow')]
    const out = removeEffect(list, 5)
    expect(out).toEqual(list)
    expect(out).not.toBe(list)
  })
})

describe('moveEffect / up / down', () => {
  const seed = (): TextEffect[] => [
    defaultTextEffect('glow'),
    defaultTextEffect('neon'),
    defaultTextEffect('glitch'),
    defaultTextEffect('blur')
  ]

  it('moves an item to a new index and preserves the rest', () => {
    const out = moveEffect(seed(), 0, 2)
    expect(out.map((e) => e.type)).toEqual(['neon', 'glitch', 'glow', 'blur'])
  })
  it('moveEffectUp shifts toward the front', () => {
    expect(moveEffectUp(seed(), 2).map((e) => e.type)).toEqual(['glow', 'glitch', 'neon', 'blur'])
  })
  it('moveEffectDown shifts toward the back', () => {
    expect(moveEffectDown(seed(), 1).map((e) => e.type)).toEqual(['glow', 'glitch', 'neon', 'blur'])
  })
  it('clamps target and no-ops at the edges (immutably)', () => {
    const list = seed()
    expect(moveEffectUp(list, 0).map((e) => e.type)).toEqual(['glow', 'neon', 'glitch', 'blur'])
    expect(moveEffectDown(list, 3).map((e) => e.type)).toEqual(['glow', 'neon', 'glitch', 'blur'])
    expect(moveEffect(list, 9, 0)).toEqual(list) // out-of-range from
    expect(moveEffectUp(list, 0)).not.toBe(list)
  })
})

describe('common-field mutators', () => {
  it('setEffectEnabled toggles or sets immutably', () => {
    const list = [defaultTextEffect('glow')]
    expect(setEffectEnabled(list, 0)[0].enabled).toBe(false)
    expect(setEffectEnabled(list, 0, true)[0].enabled).toBe(true)
    expect(list[0].enabled).toBe(true) // immutable
  })
  it('setEffectIntensity clamps to 0..1', () => {
    const list = [defaultTextEffect('glow')]
    expect(setEffectIntensity(list, 0, 0.4)[0].intensity).toBe(0.4)
    expect(setEffectIntensity(list, 0, 5)[0].intensity).toBe(1)
    expect(setEffectIntensity(list, 0, -2)[0].intensity).toBe(0)
  })
  it('setEffectOpacity clamps to 0..1', () => {
    const list = [defaultTextEffect('neon')]
    expect(setEffectOpacity(list, 0, 0.25)[0].opacity).toBe(0.25)
    expect(setEffectOpacity(list, 0, 9)[0].opacity).toBe(1)
  })
})

describe('setEffectParam', () => {
  it('updates ONE param and preserves the rest, immutably', () => {
    const list = [defaultTextEffect('glow')]
    const out = setEffectParam(list, 0, 'radius', 30)
    expect(out[0].type).toBe('glow')
    expect((out[0].params as { radius: number }).radius).toBe(30)
    expect((out[0].params as { color: string }).color).toBe('#ffffff') // other param kept
    expect((list[0].params as { radius: number }).radius).toBe(12) // immutable
  })
  it('updates a color param', () => {
    const list = [defaultTextEffect('3d')]
    const out = setEffectParam(list, 0, 'color', '#ff0000')
    expect((out[0].params as { color: string }).color).toBe('#ff0000')
  })
  it('ignores a key that is not a param of that effect type', () => {
    const list = [defaultTextEffect('blur')]
    const out = setEffectParam(list, 0, 'color', '#000000')
    expect(out[0].params).toEqual(defaultTextEffect('blur').params)
  })
})

describe('normalizeTextEffects round-trip', () => {
  it('round-trips an edited array (every survivor stays valid + ordered)', () => {
    let stack: TextEffect[] = []
    for (const t of TEXT_EFFECT_TYPES) stack = addEffect(stack, t)
    stack = setEffectIntensity(stack, 0, 0.5)
    stack = setEffectOpacity(stack, 1, 0.8)
    stack = setEffectParam(stack, 0, 'radius', 24)
    stack = setEffectEnabled(stack, 2, false)
    stack = moveEffect(stack, 6, 0)

    const round = normalizeTextEffects(stack)
    expect(round).toEqual(stack) // nothing dropped, order preserved
    expect(round.map((e) => e.type)).toEqual(stack.map((e) => e.type))
  })
})

describe('EFFECT_PARAM_META', () => {
  it('covers all effect types with their schema params', () => {
    expect(Object.keys(EFFECT_PARAM_META).sort()).toEqual([...TEXT_EFFECT_TYPES].sort())
    for (const t of TEXT_EFFECT_TYPES) {
      const metaKeys = EFFECT_PARAM_META[t].map((m) => m.key).sort()
      const paramKeys = Object.keys(defaultTextEffect(t).params).sort()
      expect(metaKeys).toEqual(paramKeys) // metadata matches the actual params shape
    }
  })
  it('sliders carry min/max/step; colors do not', () => {
    for (const t of TEXT_EFFECT_TYPES) {
      for (const m of EFFECT_PARAM_META[t]) {
        if (m.kind === 'slider') {
          expect(typeof m.min).toBe('number')
          expect(typeof m.max).toBe('number')
          expect(typeof m.step).toBe('number')
        } else {
          expect(m.kind).toBe('color')
        }
      }
    }
  })
})

describe('labels + gallery', () => {
  it('effectTypeLabel returns a label for every type', () => {
    for (const t of TEXT_EFFECT_TYPES) expect(effectTypeLabel(t).length).toBeGreaterThan(0)
  })
  it('galleryItems lists every addable type in order', () => {
    expect(galleryItems().map((g) => g.type)).toEqual([...TEXT_EFFECT_TYPES])
  })
})

describe('clamp01', () => {
  it('clamps and maps non-finite to 0', () => {
    expect(clamp01(0.3)).toBe(0.3)
    expect(clamp01(2)).toBe(1)
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(Number.NaN)).toBe(0)
  })
})
