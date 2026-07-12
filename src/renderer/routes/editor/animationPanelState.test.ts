import { describe, expect, it } from 'vitest'
import {
  ANIM_TABS,
  DEFAULT_ANIM_TAB,
  EASING_OPTIONS,
  deriveInOutLane,
  deriveLoopLane,
  galleryFor,
  inGallery,
  inOutLaneToBag,
  inOutPatch,
  loopGallery,
  loopLaneToBag,
  loopPatch,
  outGallery,
  selectInOutPreset,
  selectLoopPreset,
  selectTab,
  setInOutDuration,
  setLaneEasing,
  setLoopDuration,
  setLoopSpeed,
  setStaggerDelay,
  setStaggerUnit,
  toggleStagger
} from './animationPanelState'
import { REQUIRED_IN_PRESET_IDS } from '../../store/timeline/clipAnimationPresetsIn'
import { REQUIRED_OUT_PRESET_IDS } from '../../store/timeline/clipAnimationPresetsOut'
import { REQUIRED_LOOP_PRESET_IDS } from '../../store/timeline/clipAnimationPresetsLoop'

describe('tabs', () => {
  it('has In/Out/Loop tabs in order with In default', () => {
    expect(ANIM_TABS.map((t) => t.id)).toEqual(['in', 'out', 'loop'])
    expect(DEFAULT_ANIM_TAB).toBe('in')
  })
  it('selectTab switches to a valid tab and ignores garbage', () => {
    expect(selectTab('in', 'loop')).toBe('loop')
    // @ts-expect-error testing runtime guard against an invalid id
    expect(selectTab('in', 'bogus')).toBe('in')
  })
})

describe('galleries surface every required preset id', () => {
  it('In gallery lists all required In ids', () => {
    const ids = inGallery().map((g) => g.id)
    for (const required of REQUIRED_IN_PRESET_IDS) expect(ids).toContain(required)
  })
  it('Out gallery lists all required Out ids', () => {
    const ids = outGallery().map((g) => g.id)
    for (const required of REQUIRED_OUT_PRESET_IDS) expect(ids).toContain(required)
  })
  it('Loop gallery lists all required Loop ids', () => {
    const ids = loopGallery().map((g) => g.id)
    for (const required of REQUIRED_LOOP_PRESET_IDS) expect(ids).toContain(required)
  })
  it('galleryFor routes each tab to its catalog', () => {
    expect(galleryFor('in').map((g) => g.id)).toContain('typewriter')
    expect(galleryFor('out').map((g) => g.id)).toContain('shrink')
    expect(galleryFor('loop').map((g) => g.id)).toContain('donut')
  })
})

describe('easing dropdown', () => {
  it('offers the shared named easing list', () => {
    expect(EASING_OPTIONS).toContain('linear')
    expect(EASING_OPTIONS).toContain('easeInOut')
    expect(EASING_OPTIONS).toContain('bounce')
  })
})

describe('In/Out lane derive + select preset', () => {
  it('derives a none lane from an empty bag', () => {
    expect(deriveInOutLane(undefined).preset).toBe('none')
  })
  it('selecting a preset seeds catalog default easing + a default duration', () => {
    const lane = selectInOutPreset('in', deriveInOutLane(undefined), 'fade')
    expect(lane.preset).toBe('fade')
    expect(lane.easing).toBe('easeOut') // IN_PRESET_CATALOG fade defaultEasing
    expect(lane.durationSec).toBeGreaterThan(0)
  })
  it('the patch sets animation.in.preset', () => {
    const lane = selectInOutPreset('in', deriveInOutLane(undefined), 'zoom')
    const patch = inOutPatch('in', lane)
    expect((patch.in as { preset: string }).preset).toBe('zoom')
    expect(patch.out).toBeUndefined()
    expect(patch.loop).toBeUndefined()
  })
})

describe('duration / speed sliders update the right field', () => {
  it('duration updates the in/out durationSec only', () => {
    const lane = setInOutDuration(selectInOutPreset('in', deriveInOutLane(undefined), 'fade'), 1.25)
    expect(lane.durationSec).toBe(1.25)
    expect((inOutLaneToBag(lane) as { durationSec: number }).durationSec).toBe(1.25)
  })
  it('speed updates the loop speed only; period updates durationSec only', () => {
    let lane = selectLoopPreset(deriveLoopLane(undefined), 'pulse')
    lane = setLoopSpeed(lane, 2.5)
    expect(lane.speed).toBe(2.5)
    lane = setLoopDuration(lane, 3.2)
    expect(lane.durationSec).toBe(3.2)
    const bag = loopLaneToBag(lane) as { speed: number; durationSec: number }
    expect(bag.speed).toBe(2.5)
    expect(bag.durationSec).toBe(3.2)
  })
})

describe('stagger toggle sets unit character/word + delay', () => {
  it('enabling stagger seeds a positive delay and serializes a stagger', () => {
    let lane = selectInOutPreset('in', deriveInOutLane(undefined), 'fade')
    lane = toggleStagger(lane, true)
    expect(lane.stagger.enabled).toBe(true)
    expect(lane.stagger.delaySec).toBeGreaterThan(0)
    const bag = inOutLaneToBag(lane) as { stagger?: { unit: string; delaySec: number } }
    expect(bag.stagger?.unit).toBe('character')
  })
  it('switching to word and setting a delay serializes word + delay', () => {
    let lane = toggleStagger(selectInOutPreset('out', deriveInOutLane(undefined), 'fade'), true)
    lane = setStaggerUnit(lane, 'word')
    lane = setStaggerDelay(lane, 0.12)
    const bag = inOutLaneToBag(lane) as { stagger?: { unit: string; delaySec: number } }
    expect(bag.stagger).toEqual({ unit: 'word', delaySec: 0.12 })
  })
  it('disabled stagger leaves no stagger key in the bag', () => {
    const lane = selectInOutPreset('in', deriveInOutLane(undefined), 'fade')
    expect((inOutLaneToBag(lane) as Record<string, unknown>).stagger).toBeUndefined()
  })
  it('round-trips a stagger through derive (character is Indic-aware grapheme unit)', () => {
    const derived = deriveInOutLane({ preset: 'fade', durationSec: 0.5, easing: 'linear', stagger: { unit: 'character', delaySec: 0.03 } })
    expect(derived.stagger).toEqual({ enabled: true, unit: 'character', delaySec: 0.03 })
  })
})

describe('easing dropdown sets easing', () => {
  it('setLaneEasing changes easing; an unknown name keeps the prior', () => {
    let lane = selectInOutPreset('in', deriveInOutLane(undefined), 'fade')
    lane = setLaneEasing(lane, 'bounce')
    expect(lane.easing).toBe('bounce')
    lane = setLaneEasing(lane, 'not-a-curve')
    expect(lane.easing).toBe('bounce')
    expect((inOutLaneToBag(lane) as { easing: string }).easing).toBe('bounce')
  })
})

describe('switching tabs preserves each lane config (lane patches are isolated)', () => {
  it('an in patch and a loop patch each touch only their own lane', () => {
    const inLaneState = setInOutDuration(selectInOutPreset('in', deriveInOutLane(undefined), 'slide-left'), 0.8)
    const loopLaneState = setLoopSpeed(selectLoopPreset(deriveLoopLane(undefined), 'wave'), 1.5)

    const inP = inOutPatch('in', inLaneState)
    const loopP = loopPatch(loopLaneState)

    // Simulate the store merge over a fresh animation bag.
    const merged = { ...inP, ...loopP }
    expect((merged.in as { preset: string }).preset).toBe('slide-left')
    expect((merged.loop as { preset: string }).preset).toBe('wave')
    // Re-deriving each lane from the merged bag yields the authored values.
    expect(deriveInOutLane(merged.in as Record<string, unknown>).durationSec).toBe(0.8)
    expect(deriveLoopLane(merged.loop as Record<string, unknown>).speed).toBe(1.5)
  })
})

describe('none preset', () => {
  it('selecting none serializes { preset: none } so the paint resolver drops the lane', () => {
    const lane = selectInOutPreset('in', selectInOutPreset('in', deriveInOutLane(undefined), 'fade'), 'none')
    expect(lane.preset).toBe('none')
    expect(inOutLaneToBag(lane)).toEqual({ preset: 'none' })
  })
})
