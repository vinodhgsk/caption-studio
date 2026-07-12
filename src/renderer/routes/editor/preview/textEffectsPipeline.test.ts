import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  composeEffectsPass,
  getEffectRenderer,
  hasEffectRenderer,
  registerEffectRenderer,
  registeredEffectTypes,
  renderOneEffect,
  unregisterEffectRenderer,
  type EffectRenderer
} from './textEffectsPipeline'
import { registerBuiltinEffects } from './textEffectsBuiltin'
import { paintGlyphPasses, type GlyphToken } from './textPaintPipeline'
import { defaultTextEffect, type TextEffect, type TextEffectType } from '../../../../shared/textEffect'

const TOKEN: GlyphToken = { text: 'Ab', x: 0, y: 0 }
const ALL_TYPES: TextEffectType[] = ['glow', 'neon', 'glitch', '3d', 'retro', 'blur', 'echo']

/** Minimal recording ctx — logs fillText calls + tracks globalAlpha/filter. */
function recordingCtx(): {
  ctx: CanvasRenderingContext2D
  fills: { text: string; alpha: number; filter: string }[]
} {
  const fills: { text: string; alpha: number; filter: string }[] = []
  const state = { globalAlpha: 1, filter: 'none', fillStyle: '', font: '' }
  const ctx = {
    save() {},
    restore() {},
    translate() {},
    scale() {},
    rotate() {},
    fillText(text: string) {
      fills.push({ text, alpha: state.globalAlpha, filter: state.filter })
    },
    strokeText() {}
  }
  Object.defineProperties(ctx, {
    globalAlpha: { get: () => state.globalAlpha, set: (v) => (state.globalAlpha = v) },
    filter: { get: () => state.filter, set: (v) => (state.filter = v) },
    fillStyle: { get: () => state.fillStyle, set: (v) => (state.fillStyle = v) },
    font: { get: () => state.font, set: (v) => (state.font = v) },
    shadowColor: { get: () => 'transparent', set: () => {} },
    shadowBlur: { get: () => 0, set: () => {} },
    shadowOffsetX: { get: () => 0, set: () => {} },
    shadowOffsetY: { get: () => 0, set: () => {} },
    globalCompositeOperation: { get: () => 'source-over', set: () => {} }
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills }
}

// Each test owns the registry: clear all, then restore the builtins after.
beforeEach(() => {
  for (const t of ALL_TYPES) unregisterEffectRenderer(t)
})
afterEach(() => {
  for (const t of ALL_TYPES) unregisterEffectRenderer(t)
  registerBuiltinEffects()
})

describe('effect registry — register/get/dispatch', () => {
  it('register then get returns the renderer; has reflects it', () => {
    expect(hasEffectRenderer('glow')).toBe(false)
    const r: EffectRenderer = () => {}
    registerEffectRenderer('glow', r)
    expect(hasEffectRenderer('glow')).toBe(true)
    expect(getEffectRenderer('glow')).toBe(r)
    expect(registeredEffectTypes()).toContain('glow')
  })

  it('re-registering a type overwrites (last wins)', () => {
    const a: EffectRenderer = () => {}
    const b: EffectRenderer = () => {}
    registerEffectRenderer('neon', a)
    registerEffectRenderer('neon', b)
    expect(getEffectRenderer('neon')).toBe(b)
  })

  it('unregister removes the renderer', () => {
    registerEffectRenderer('glitch', () => {})
    unregisterEffectRenderer('glitch')
    expect(hasEffectRenderer('glitch')).toBe(false)
    expect(getEffectRenderer('glitch')).toBeUndefined()
  })

  it('renderOneEffect dispatches to the registered renderer with params + context', () => {
    const seen: { params: unknown; intensity: number }[] = []
    registerEffectRenderer('glow', (_c, _t, params, context) => {
      seen.push({ params, intensity: context.intensity })
    })
    const { ctx } = recordingCtx()
    const effect = defaultTextEffect('glow')
    renderOneEffect(ctx, TOKEN, effect, { shadow: null, stroke: null })
    expect(seen).toHaveLength(1)
    expect(seen[0].params).toEqual(effect.params)
    expect(seen[0].intensity).toBe(1)
  })

  it('renderOneEffect skips disabled / zero-opacity / unregistered effects', () => {
    const calls: TextEffectType[] = []
    registerEffectRenderer('glow', () => calls.push('glow'))
    const { ctx } = recordingCtx()
    renderOneEffect(ctx, TOKEN, { ...defaultTextEffect('glow'), enabled: false }, { shadow: null, stroke: null })
    renderOneEffect(ctx, TOKEN, { ...defaultTextEffect('glow'), opacity: 0 }, { shadow: null, stroke: null })
    // 'neon' has no renderer registered → safe no-op
    renderOneEffect(ctx, TOKEN, defaultTextEffect('neon'), { shadow: null, stroke: null })
    expect(calls).toEqual([])
  })

  it('renderOneEffect multiplies the effect opacity into globalAlpha', () => {
    let seenAlpha = -1
    registerEffectRenderer('glow', (c) => {
      seenAlpha = c.globalAlpha
    })
    const { ctx } = recordingCtx()
    ctx.globalAlpha = 0.5
    renderOneEffect(ctx, TOKEN, { ...defaultTextEffect('glow'), opacity: 0.4 }, { shadow: null, stroke: null })
    expect(seenAlpha).toBeCloseTo(0.2)
  })
})

describe('composeEffectsPass — ordering + passthrough', () => {
  it('returns undefined for an empty stack (passthrough — no change)', () => {
    expect(composeEffectsPass([])).toBeUndefined()
  })

  it('returns undefined when all effects are disabled / transparent / unregistered', () => {
    // none registered → unregistered → undefined
    expect(composeEffectsPass([defaultTextEffect('glow'), defaultTextEffect('neon')])).toBeUndefined()
    registerEffectRenderer('glow', () => {})
    expect(composeEffectsPass([{ ...defaultTextEffect('glow'), enabled: false }])).toBeUndefined()
    expect(composeEffectsPass([{ ...defaultTextEffect('glow'), opacity: 0 }])).toBeUndefined()
  })

  it('applies effects IN ARRAY ORDER over the glyph', () => {
    const order: string[] = []
    registerEffectRenderer('glow', () => order.push('glow'))
    registerEffectRenderer('glitch', () => order.push('glitch'))
    registerEffectRenderer('blur', () => order.push('blur'))
    const pass = composeEffectsPass([
      defaultTextEffect('glitch'),
      defaultTextEffect('glow'),
      defaultTextEffect('blur')
    ])
    expect(pass).toBeDefined()
    const { ctx } = recordingCtx()
    pass!(ctx, TOKEN, { shadow: null, stroke: null })
    expect(order).toEqual(['glitch', 'glow', 'blur'])
  })

  it('skips disabled/unregistered entries but keeps the order of the rest', () => {
    const order: string[] = []
    registerEffectRenderer('glow', () => order.push('glow'))
    registerEffectRenderer('blur', () => order.push('blur'))
    const pass = composeEffectsPass([
      defaultTextEffect('glow'),
      { ...defaultTextEffect('glitch') }, // unregistered → skipped
      { ...defaultTextEffect('blur'), enabled: false }, // disabled → skipped
      defaultTextEffect('blur')
    ])
    const { ctx } = recordingCtx()
    pass!(ctx, TOKEN, { shadow: null, stroke: null })
    expect(order).toEqual(['glow', 'blur'])
  })
})

describe('pipeline integration — effects compose at pass 5, after fill, before highlight', () => {
  it('the composed pass runs between fill and highlight in paintGlyphPasses', () => {
    const phases: string[] = []
    registerEffectRenderer('glow', () => phases.push('effect'))
    const pass = composeEffectsPass([defaultTextEffect('glow')])
    const { ctx } = recordingCtx()
    paintGlyphPasses({
      ctx,
      token: TOKEN,
      shadow: null,
      stroke: null,
      fill: () => phases.push('fill'),
      effects: pass,
      highlight: () => phases.push('highlight')
    })
    expect(phases).toEqual(['fill', 'effect', 'highlight'])
  })

  it('an empty effect stack leaves paintGlyphPasses output identical (backward compat)', () => {
    const fillSpy = vi.fn()
    const { ctx, fills } = recordingCtx()
    // No effects pass at all.
    paintGlyphPasses({ ctx, token: TOKEN, shadow: null, stroke: null, fill: (c, tk) => { fillSpy(); c.fillText(tk.text, tk.x, tk.y) } })
    const withoutEffects = fills.length
    fills.length = 0
    // composeEffectsPass([]) → undefined → same path.
    paintGlyphPasses({ ctx, token: TOKEN, shadow: null, stroke: null, effects: composeEffectsPass([]), fill: (c, tk) => c.fillText(tk.text, tk.x, tk.y) })
    expect(fills.length).toBe(withoutEffects)
  })
})

describe('blur (P7.6 real Gaussian) — registered builtin composes', () => {
  beforeEach(() => registerBuiltinEffects())

  it('registers the blur renderer', () => {
    expect(hasEffectRenderer('blur')).toBe(true)
  })

  it('FILTER path: re-stamps the glyph once under a gaussian filter scaled by intensity', () => {
    // This recordingCtx exposes a STICKY `ctx.filter` setter → the renderer takes the
    // real-Gaussian filter path (one re-stamp under blur(Npx)).
    const effect: TextEffect = { ...defaultTextEffect('blur'), params: { radius: 4 }, intensity: 1, opacity: 1 }
    const pass = composeEffectsPass([effect])
    expect(pass).toBeDefined()
    const { ctx, fills } = recordingCtx()
    pass!(ctx, TOKEN, { shadow: null, stroke: null })
    // Exactly one re-stamp of the token, under the blur filter (radius*intensity px).
    expect(fills).toHaveLength(1)
    expect(fills[0].text).toBe('Ab')
    expect(fills[0].filter).toBe('blur(4px)')
  })

  it('FILTER path: blur px = radius*intensity', () => {
    const effect: TextEffect = { ...defaultTextEffect('blur'), params: { radius: 10 }, intensity: 0.5 }
    const { ctx, fills } = recordingCtx()
    composeEffectsPass([effect])!(ctx, TOKEN, { shadow: null, stroke: null })
    expect(fills).toHaveLength(1)
    expect(fills[0].filter).toBe('blur(5px)') // 10 * 0.5
  })

  it('resets ctx.filter to none after (no leak to the next effect / highlight)', () => {
    const effect: TextEffect = { ...defaultTextEffect('blur'), params: { radius: 4 } }
    const { ctx } = recordingCtx()
    composeEffectsPass([effect])!(ctx, TOKEN, { shadow: null, stroke: null })
    expect((ctx as unknown as { filter: string }).filter).toBe('none')
  })

  it('blur with zero effective radius (intensity 0) is a no-op', () => {
    const effect: TextEffect = { ...defaultTextEffect('blur'), params: { radius: 8 }, intensity: 0 }
    const pass = composeEffectsPass([effect])
    const { ctx, fills } = recordingCtx()
    pass!(ctx, TOKEN, { shadow: null, stroke: null })
    expect(fills).toHaveLength(0)
    expect((ctx as unknown as { filter: string }).filter).toBe('none')
  })

  it('FALLBACK path: a ctx whose filter setter is ignored gets multiple low-alpha ring stamps', () => {
    // A ctx WITHOUT a usable `ctx.filter` (the setter is ignored → reads back 'none').
    const fills: { text: string; alpha: number; filter: string }[] = []
    const state = { globalAlpha: 1, fillStyle: '', font: '' }
    const noFilterCtx = {
      save() {},
      restore() {},
      fillText(text: string) {
        fills.push({ text, alpha: state.globalAlpha, filter: 'none' })
      },
      strokeText() {}
    }
    Object.defineProperties(noFilterCtx, {
      globalAlpha: { get: () => state.globalAlpha, set: (v: number) => (state.globalAlpha = v) },
      fillStyle: { get: () => state.fillStyle, set: (v: string) => (state.fillStyle = v) },
      font: { get: () => state.font, set: (v: string) => (state.font = v) },
      // filter setter is ignored → always reads 'none' → filterOk is false → fallback.
      filter: { get: () => 'none', set: () => {} },
      globalCompositeOperation: { get: () => 'source-over', set: () => {} }
    })
    const ctx = noFilterCtx as unknown as CanvasRenderingContext2D
    const effect: TextEffect = { ...defaultTextEffect('blur'), params: { radius: 6 }, intensity: 1 }
    composeEffectsPass([effect])!(ctx, TOKEN, { shadow: null, stroke: null })
    // The fallback stamps the center + ring offsets — many low-alpha copies.
    expect(fills.length).toBeGreaterThan(1)
    expect(fills.every((f) => f.text === 'Ab')).toBe(true)
    // Every fallback stamp is at a LOW alpha (< 1) so they sum into a soft blob.
    expect(fills.every((f) => f.alpha < 1)).toBe(true)
  })

  it('blur composes AFTER the fill in the full pipeline (behind the crisp face)', () => {
    registerBuiltinEffects()
    const order: string[] = []
    const { ctx } = recordingCtx()
    paintGlyphPasses({
      ctx,
      token: TOKEN,
      shadow: null,
      stroke: null,
      fill: (c, tk) => {
        order.push('fill')
        c.fillText(tk.text, tk.x, tk.y)
      },
      effects: composeEffectsPass([defaultTextEffect('blur')])
    })
    expect(order).toEqual(['fill'])
  })
})
