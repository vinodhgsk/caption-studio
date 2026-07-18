const fs = require('fs')

const filepath = 'src/renderer/routes/editor/AutoCaptionPanel.tsx'
let text = fs.readFileSync(filepath, 'utf-8')

// 1. Add import CaptionStyleSection
text = text.replace(
  "import { CAPTION_TRACK_ID } from '@/store/timeline'",
  "import { CAPTION_TRACK_ID } from '@/store/timeline'\nimport { CaptionStyleSection } from './CaptionStyleSection'"
)

// 1b. Remove unused actions from imports/destructs
text = text.replace(/  setCaptionLineHeightAction,\n/g, '')
text = text.replace(/  setCaptionLetterSpacingAction,\n/g, '')
text = text.replace(/  wrapCaptionTextAction,\n/g, '')
text = text.replace(/  wrapCaptionTextAction\n/g, '')

// 2. Remove states
const statesBlock = `  // Default matches the Sarvam Bhakti Gold preset's font size (the applied
  // default), so the size control reflects what's on screen out of the box.
  const [captionFontSize, setCaptionFontSize] = useState(144)
  // Chosen caption font family (panel-owned, like font size) so it PERSISTS across
  // (re)generate/resync — those rebuild+restyle the clips and would otherwise
  // revert to the preset's font. Default = the default preset's face.
  const [captionFont, setCaptionFont] = useState('Baloo Thambi 2')
  // Word-wrap toggle: when on, each caption wraps to \`maxWordsPerLine\` words.
  const [wordWrap, setWordWrap] = useState(false)
  const [maxWordsPerLine, setMaxWordsPerLine] = useState(4)
  const [lineSpacing, setLineSpacing] = useState(1.4)
  const [letterSpacing, setLetterSpacing] = useState(0)

  // Fill state
  const [fillColor, setFillColor] = useState('#ffffff')
  const [fillOpacity, setFillOpacity] = useState(100)
  const [fillGradient, setFillGradient] = useState(false)
  const [fillStop1, setFillStop1] = useState('#ffffff')
  const [fillStop2, setFillStop2] = useState('#f5c842')
  const [fillAngle, setFillAngle] = useState(90)

  // Stroke state
  const [strokeOn, setStrokeOn] = useState(false)
  const [strokeColor, setStrokeColor] = useState('#000000')
  const [strokeWidth, setStrokeWidth] = useState(12)

  // Glow state
  const [glowOn, setGlowOn] = useState(false)
  const [glowColor, setGlowColor] = useState('#ffffff')
  const [glowRadius, setGlowRadius] = useState(12)

  // Shadow state
  const [shadowOn, setShadowOn] = useState(false)
  const [shadowColor, setShadowColor] = useState('#000000')
  const [shadowOpacity, setShadowOpacity] = useState(60)
  const [shadowBlur, setShadowBlur] = useState(8)
  const [shadowAngle, setShadowAngle] = useState(135)
  const [shadowDistance, setShadowDistance] = useState(4)`
text = text.replace(statesBlock, "")

// 3. Remove useEffect
const effectBlock = `  useEffect(() => {
    const clip = captionClips[0]
    if (clip?.text === undefined) return
    const text = clip.text
    const fill = text.fill as { type?: string; value?: unknown; opacity?: number; angle?: number } | undefined
    if (fill !== undefined) {
      if (fill.type === 'gradient' && Array.isArray(fill.value)) {
        setFillGradient(true)
        const stops = fill.value as { offset: number; color: string }[]
        if (stops[0] !== undefined) setFillStop1(stops[0].color)
        if (stops[1] !== undefined) setFillStop2(stops[1].color)
        if (fill.angle !== undefined) setFillAngle(fill.angle)
      } else if (typeof fill.value === 'string') {
        setFillGradient(false)
        setFillColor(fill.value)
      }
      if (fill.opacity !== undefined) setFillOpacity(Math.round(fill.opacity * 100))
    }
    const stroke = text.stroke as { color: string; width: number }[] | undefined
    if (stroke !== undefined && stroke.length > 0) {
      setStrokeOn(true)
      setStrokeColor(stroke[0].color)
      setStrokeWidth(stroke[0].width)
    } else {
      setStrokeOn(false)
    }
    const effects = text.effects as { type: string; params?: { radius?: number; color?: string } }[] | undefined
    const glow = effects?.find((e) => e.type === 'glow')
    if (glow !== undefined) {
      setGlowOn(true)
      if (glow.params?.color !== undefined) setGlowColor(glow.params.color)
      if (glow.params?.radius !== undefined) setGlowRadius(glow.params.radius)
    } else {
      setGlowOn(false)
    }
    const shadow = text.shadow as { color?: string; opacity?: number; blur?: number; angle?: number; distance?: number } | undefined
    if (shadow !== undefined) {
      setShadowOn(true)
      if (shadow.color !== undefined) setShadowColor(shadow.color)
      if (shadow.opacity !== undefined) setShadowOpacity(Math.round(shadow.opacity * 100))
      if (shadow.blur !== undefined) setShadowBlur(shadow.blur)
      if (shadow.angle !== undefined) setShadowAngle(shadow.angle)
      if (shadow.distance !== undefined) setShadowDistance(shadow.distance)
    } else {
      setShadowOn(false)
    }

    const font = text.font as { family?: string; size?: number; lineHeight?: number; letterSpacing?: number } | undefined
    if (font !== undefined) {
      if (font.family !== undefined) setCaptionFont(font.family)
      if (font.size !== undefined) setCaptionFontSize(font.size)
      if (font.lineHeight !== undefined) setLineSpacing(font.lineHeight)
      if (font.letterSpacing !== undefined) setLetterSpacing(font.letterSpacing)
    }
  }, [captionClips])`
text = text.replace(effectBlock, "")

// 4. Remove fontOptions
const fontOptBlock = `  // Font options grouped: Tamil-devotional faces first (best fit for the gold
  // style), then the rest of the library. Built from the font registry so newly
  // bundled families appear automatically.
  const fontOptions = useMemo(() => {
    const all = fontRegistry.listFonts().map((f) => f.family)
    const tamilFirst = fontRegistry
      .listFonts()
      .filter((f) => f.scripts.includes('tamil'))
      .map((f) => f.family)
    const rest = all.filter((f) => !tamilFirst.includes(f))
    return { tamil: tamilFirst, rest }
  }, [])`
text = text.replace(fontOptBlock, "")

// 5. Remove applyCaptionRefinements
const refineBlock = `  // Re-apply the panel's caption refinements (font family + size, and word wrap)
  // AFTER the style preset is stamped, so a (re)generate/resync keeps the user's
  // chosen font/size instead of reverting to the preset's, and honors the wrap
  // toggle. Panel-owned state is the source of truth for these.
  const applyCaptionRefinements = (): void => {
    setCaptionFontFamilyAction(captionFont)
    setCaptionFontSizeAction(captionFontSize)
    if (wordWrap && maxWordsPerLine > 0) wrapCaptionTextAction(maxWordsPerLine)
    if (fillGradient) {
      setCaptionFillAction({
        type: 'gradient',
        value: [{ offset: 0, color: fillStop1 }, { offset: 1, color: fillStop2 }],
        opacity: fillOpacity / 100,
        angle: fillAngle
      })
    } else {
      setCaptionFillAction({ type: 'solid', value: fillColor, opacity: fillOpacity / 100 })
    }
    setCaptionStrokeAction(strokeOn ? [{ color: strokeColor, width: strokeWidth }] : [])
    setCaptionGlowAction(glowOn ? { color: glowColor, radius: glowRadius } : null)
    setCaptionShadowAction(
      shadowOn
        ? { color: shadowColor, opacity: shadowOpacity / 100, blur: shadowBlur, angle: shadowAngle, distance: shadowDistance, inner: false, long: false }
        : null
    )
  }`
text = text.replace(refineBlock, "")
text = text.replace(/      applyCaptionRefinements\(\)\n/g, "")

// 6. Replace Caption style section
const lines = text.split('\n')
const secStart = lines.findIndex(l => l.includes('<Section title="Caption style">'))
if (secStart !== -1) {
  let depth = 0
  let secEnd = -1
  for (let i = secStart; i < lines.length; i++) {
    if (lines[i].includes('<Section')) depth++
    if (lines[i].includes('</Section>')) {
      depth--
      if (depth === 0) {
        secEnd = i
        break
      }
    }
  }
  if (secEnd !== -1) {
    lines.splice(secStart, secEnd - secStart + 1, "      <CaptionStyleSection disabled={running} />")
    text = lines.join('\n')
  }
}

fs.writeFileSync(filepath, text)
console.log('Patched AutoCaptionPanel.tsx perfectly.')
