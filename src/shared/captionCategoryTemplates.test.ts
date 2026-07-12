import { afterEach, describe, expect, it } from 'vitest'
import {
  captionPresetToClipStyle,
  validateCaptionPreset,
  type CaptionPresetGroup
} from './captionPreset'
import {
  BUILT_IN_PRESET_IDS,
  getCaptionPreset,
  isBuiltInPreset,
  listCaptionPresets,
  unregisterCaptionPreset
} from './captionPresetRegistry'
import {
  CATEGORY_TEMPLATE_IDS,
  LOWER_THIRD_GAME,
  LOWER_THIRD_SPORTS,
  LOWER_THIRD_TECH,
  LOWER_THIRD_TRENDING,
  TITLE_CARD_GAME,
  TITLE_CARD_SPORTS,
  TITLE_CARD_TECH,
  TITLE_CARD_TRENDING,
  groupPresetsByCategory,
  listCaptionCategoryTemplates,
  registerCaptionCategoryTemplates
} from './captionCategoryTemplates'

// Keep the global registry clean between tests (built-ins survive; extras removed).
afterEach(() => {
  for (const p of listCaptionPresets()) {
    if (!isBuiltInPreset(p.id)) unregisterCaptionPreset(p.id)
  }
})

const LOWER_THIRD_IDS = [LOWER_THIRD_GAME, LOWER_THIRD_TECH, LOWER_THIRD_SPORTS, LOWER_THIRD_TRENDING]
const TITLE_CARD_IDS = [TITLE_CARD_GAME, TITLE_CARD_TECH, TITLE_CARD_SPORTS, TITLE_CARD_TRENDING]

describe('category template definitions', () => {
  it('ships 8 templates: a lower-third + a title-card per Game/Tech/Sports/Trending', () => {
    const all = listCaptionCategoryTemplates()
    expect(all).toHaveLength(8)
    expect(all.filter((p) => p.category === 'lower-third')).toHaveLength(4)
    expect(all.filter((p) => p.category === 'title-card')).toHaveLength(4)
    for (const group of ['game', 'tech', 'sports', 'trending'] as CaptionPresetGroup[]) {
      const inGroup = all.filter((p) => p.group === group)
      expect(inGroup.map((p) => p.category).sort()).toEqual(['lower-third', 'title-card'])
    }
  })

  it('every template validates per validateCaptionPreset', () => {
    for (const p of listCaptionCategoryTemplates()) {
      const res = validateCaptionPreset(p)
      expect(res.ok, `${p.id} should validate: ${res.ok ? '' : JSON.stringify(res.issues)}`).toBe(true)
    }
  })

  it('template ids are unique and do not collide with the built-ins', () => {
    expect(new Set(CATEGORY_TEMPLATE_IDS).size).toBe(CATEGORY_TEMPLATE_IDS.length)
    for (const id of CATEGORY_TEMPLATE_IDS) {
      expect(BUILT_IN_PRESET_IDS.includes(id as never)).toBe(false)
      expect(isBuiltInPreset(id)).toBe(false)
    }
  })

  it('all templates use an Indic-capable default font (Tamil) so Tamil/Indic shape', () => {
    for (const p of listCaptionCategoryTemplates()) {
      const families = [p.font.family, ...(p.font.fallback ?? [])].join(' ').toLowerCase()
      expect(families, `${p.id} should reference a Tamil-capable family`).toContain('tamil')
    }
  })
})

describe('anchors + entrance animations per category', () => {
  it('lower thirds anchor LOW (lower-third) and SLIDE in', () => {
    for (const id of LOWER_THIRD_IDS) {
      const p = listCaptionCategoryTemplates().find((x) => x.id === id)!
      expect(p.layout.anchor).toBe('lower-third')
      expect(p.animation.in?.preset).toMatch(/^slide-/)
      // overlays are not spoken: no per-word reveal, no active-word highlight
      expect(p.animation.reveal?.mode).toBe('none')
      expect(p.highlight.enabled).toBe(false)
    }
  })

  it('title cards anchor center/upper and ZOOM/SCALE in', () => {
    for (const id of TITLE_CARD_IDS) {
      const p = listCaptionCategoryTemplates().find((x) => x.id === id)!
      expect(['center', 'top']).toContain(p.layout.anchor)
      expect(p.animation.in?.preset).toMatch(/^(zoom-in|scale-up)$/)
      expect(p.animation.reveal?.mode).toBe('none')
      expect(p.highlight.enabled).toBe(false)
    }
  })

  it('entrance animations differ between lower-thirds (slide) and title-cards (zoom/scale)', () => {
    const lt = LOWER_THIRD_IDS.map((id) => getTemplate(id).animation.in?.preset)
    const tc = TITLE_CARD_IDS.map((id) => getTemplate(id).animation.in?.preset)
    for (const a of lt) for (const b of tc) expect(a).not.toBe(b)
  })

  it('each category has a distinct visual identity (fill/font differ across themes)', () => {
    const lt = LOWER_THIRD_IDS.map(getTemplate)
    // Distinct primary fills across themes (solid hexes + the trending gradient).
    const fillKeys = lt.map((p) => JSON.stringify(p.fill.value))
    expect(new Set(fillKeys).size).toBe(4)
    // Trending uses a gradient fill; others are solid.
    expect(getTemplate(LOWER_THIRD_TRENDING).fill.type).toBe('gradient')
    expect(getTemplate(LOWER_THIRD_GAME).fill.type).toBe('solid')
  })
})

function getTemplate(id: string) {
  return listCaptionCategoryTemplates().find((x) => x.id === id)!
}

describe('registration into the shared registry', () => {
  it('registers all 8 templates so listCaptionPresets exposes them (P5.3 gallery)', () => {
    const added = registerCaptionCategoryTemplates()
    expect(added.sort()).toEqual([...CATEGORY_TEMPLATE_IDS].sort())
    const ids = listCaptionPresets().map((p) => p.id)
    for (const id of CATEGORY_TEMPLATE_IDS) expect(ids).toContain(id)
    // built-ins still come first and are unchanged in count
    expect(ids.slice(0, BUILT_IN_PRESET_IDS.length)).toEqual([...BUILT_IN_PRESET_IDS])
  })

  it('is idempotent — calling twice does not duplicate, second call adds nothing', () => {
    expect(registerCaptionCategoryTemplates()).toHaveLength(8)
    expect(registerCaptionCategoryTemplates()).toHaveLength(0)
    const count = listCaptionPresets().filter((p) => CATEGORY_TEMPLATE_IDS.includes(p.id as never)).length
    expect(count).toBe(8)
  })

  it('templates resolve through getCaptionPreset once registered (P5.4 apply path)', () => {
    expect(getCaptionPreset(TITLE_CARD_GAME)).toBeUndefined()
    registerCaptionCategoryTemplates()
    expect(getCaptionPreset(TITLE_CARD_GAME)?.id).toBe(TITLE_CARD_GAME)
  })
})

describe('groupPresetsByCategory', () => {
  it('buckets templates by category and themed group, in stable order', () => {
    registerCaptionCategoryTemplates()
    const sections = groupPresetsByCategory(listCaptionPresets())
    const cats = sections.map((s) => s.category)
    expect(cats).toEqual(['caption', 'lower-third', 'title-card'])

    const lowerThird = sections.find((s) => s.category === 'lower-third')!
    expect(lowerThird.groups.map((g) => g.group)).toEqual(['game', 'tech', 'sports', 'trending'])
    for (const g of lowerThird.groups) {
      expect(g.presets).toHaveLength(1)
      expect(g.presets[0].group).toBe(g.group)
    }

    // The caption built-ins land in the 'caption' section's ungrouped bucket.
    const caption = sections.find((s) => s.category === 'caption')!
    expect(caption.groups.map((g) => g.group)).toEqual(['ungrouped'])
    expect(caption.groups[0].presets.length).toBe(BUILT_IN_PRESET_IDS.length)
  })

  it('omits empty sections/groups', () => {
    // Only caption built-ins → no lower-third / title-card sections.
    const sections = groupPresetsByCategory(listCaptionPresets())
    expect(sections.map((s) => s.category)).toEqual(['caption'])
  })
})

describe('apply machinery reuse (preset → clip style)', () => {
  it('a lower-third stamps a low anchor (positive y) + a slide entrance animation', () => {
    const p = getTemplate(LOWER_THIRD_SPORTS)
    const style = captionPresetToClipStyle(p)
    // lower-third anchor resolves to a positive (downward) y offset
    expect(style.transformPatch.y).toBeGreaterThan(0)
    // entrance animation copied through onto clip.animation.in
    expect(style.animation.in?.preset).toBe(p.animation.in?.preset)
    expect(style.animation.in?.preset).toMatch(/^slide-/)
  })

  it('a title-card stamps a center/upper anchor + a zoom/scale entrance animation', () => {
    const p = getTemplate(TITLE_CARD_GAME)
    const style = captionPresetToClipStyle(p)
    // center anchor → y at 0 (or negative for 'top')
    expect(style.transformPatch.y).toBeLessThanOrEqual(0)
    expect(style.animation.in?.preset).toBe('zoom-in')
  })

  it('the trending title-card (top anchor) stamps a negative (upward) y offset', () => {
    const p = getTemplate(TITLE_CARD_TRENDING)
    const style = captionPresetToClipStyle(p)
    expect(style.transformPatch.y).toBeLessThan(0)
    expect(style.animation.in?.preset).toBe('scale-up')
  })

  it('decoration (background bar/box) carries through to clip text style for lower thirds', () => {
    const p = getTemplate(LOWER_THIRD_TECH)
    const style = captionPresetToClipStyle(p)
    expect(style.text.decoration).toBeDefined()
  })
})

describe('group field on the schema is additive + validated', () => {
  it('accepts a valid group and rejects an unknown one', () => {
    const base = getTemplate(LOWER_THIRD_GAME)
    expect(validateCaptionPreset({ ...base, group: 'tech' }).ok).toBe(true)
    const bad = validateCaptionPreset({ ...base, group: 'nope' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.issues.some((i) => i.path === 'group')).toBe(true)
  })

  it('a preset without a group is still valid (backward compatible)', () => {
    const base = getTemplate(LOWER_THIRD_GAME)
    const withoutGroup = { ...base }
    delete withoutGroup.group
    expect(validateCaptionPreset(withoutGroup).ok).toBe(true)
  })
})
