const fs = require('fs')

const filepath = 'src/renderer/routes/editor/AutoCaptionPanel.tsx'
let lines = fs.readFileSync(filepath, 'utf-8').split('\n')

// 1. Add import CaptionStyleSection
const importIdx = lines.findIndex(l => l.includes("import { CAPTION_TRACK_ID } from '@/store/timeline'"))
if (importIdx !== -1) {
  lines.splice(importIdx + 1, 0, "import { CaptionStyleSection } from './CaptionStyleSection'")
}

// 2. Remove states
const stateStart = lines.findIndex(l => l.includes("const [captionFontSize, setCaptionFontSize] = useState(")) - 2
const stateEnd = lines.findIndex(l => l.includes("const [shadowDistance, setShadowDistance] = useState("))
if (stateStart !== -1 && stateEnd !== -1) {
  lines.splice(stateStart, stateEnd - stateStart + 1)
}

// 3. Remove useEffect
const effectStart = lines.findIndex((l, i) => l.includes("useEffect(() => {") && lines[i+1].includes("const clip = captionClips[0]"))
const effectEnd = lines.findIndex((l, i) => i > effectStart && l.includes("}, [captionClips])"))
if (effectStart !== -1 && effectEnd !== -1) {
  lines.splice(effectStart, effectEnd - effectStart + 1)
}

// 4. Remove applyCaptionRefinements and its calls
const refStart = lines.findIndex(l => l.includes("const applyCaptionRefinements = (): void => {")) - 4
const refEnd = lines.findIndex((l, i) => i > refStart && l.includes("}"))
if (refStart !== -1 && refEnd !== -1) {
  lines.splice(refStart, refEnd - refStart + 1)
}
lines = lines.filter(l => !l.includes('applyCaptionRefinements()'))

// 4b. Remove fontOptions
const fontOptStart = lines.findIndex(l => l.includes("const fontOptions = useMemo(() => {")) - 3
const fontOptEnd = lines.findIndex((l, i) => i > fontOptStart && l.includes("}, [])"))
if (fontOptStart !== -1 && fontOptEnd !== -1) {
  lines.splice(fontOptStart, fontOptEnd - fontOptStart + 1)
}

// 5. Replace Section "Caption style"
const secStart = lines.findIndex(l => l.includes('<Section title="Caption style">'))
const secEnd = lines.findIndex((l, i) => i > secStart && l.includes('</Section>')) // Finds the first closing tag after Caption style
if (secStart !== -1 && secEnd !== -1) {
  lines.splice(secStart - 1, secEnd - secStart + 2, "      <CaptionStyleSection disabled={running} />\n")
}

fs.writeFileSync(filepath, lines.join('\n'))
console.log('Patched AutoCaptionPanel.tsx safely.')
