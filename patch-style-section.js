const fs = require('fs')

const filepath = 'src/renderer/routes/editor/CaptionStyleSection.tsx'
let text = fs.readFileSync(filepath, 'utf-8')

// 1. Remove deriveHollow
text = text.replace('deriveHollow,\n', '')
text = text.replace('  deriveHollow,\n', '')

// 2. font.bold to font.weight >= 600
text = text.replace(/font\.bold/g, '(font.weight >= 600)')

// 3. shadowState.type value
text = text.replace(
  'value={shadowState.type}',
  "value={shadowState.on ? shadowState.type : 'none'}"
)

// 4. decorationToBag to pass firstClip?.text?.decoration
text = text.replace(/decorationToBag\(\{/g, 'decorationToBag(firstClip?.text?.decoration, {')

fs.writeFileSync(filepath, text)
console.log('Patched CaptionStyleSection.tsx')
