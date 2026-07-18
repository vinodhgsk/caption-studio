const fs = require('fs')

let t = fs.readFileSync('src/renderer/routes/editor/CaptionStyleSection.tsx', 'utf8')
t = t.replace(/font\.weight >= 600/g, 'Number(font.weight) >= 600')
t = t.replace(/e\.target\.value === 'none'/g, "e.target.value === ('none' as string)")
fs.writeFileSync('src/renderer/routes/editor/CaptionStyleSection.tsx', t)

let a = fs.readFileSync('src/renderer/routes/editor/AutoCaptionPanel.tsx', 'utf8')
a = a.replace(/,\n  setCaptionLineHeightAction,\n  setCaptionLetterSpacingAction/g, '')
a = a.replace(/,\n  setCaptionLineHeightAction/g, '')
a = a.replace(/,\n  setCaptionLetterSpacingAction/g, '')
a = a.replace(/const \[wordWrap, setWordWrap\] = useState\(false\)\n/g, '')
a = a.replace(/const \[maxWordsPerLine, setMaxWordsPerLine\] = useState\(4\)\n/g, '')
a = a.replace(/const \[lineSpacing, setLineSpacing\] = useState\(1\.4\)\n/g, '')
a = a.replace(/const \[letterSpacing, setLetterSpacing\] = useState\(0\)\n/g, '')

const fontOptBlock = `  const fontOptions = useMemo(() => {
    const all = fontRegistry.listFonts().map((f) => f.family)
    const tamilFirst = fontRegistry
      .listFonts()
      .filter((f) => f.scripts.includes('tamil'))
      .map((f) => f.family)
    const rest = all.filter((f) => !tamilFirst.includes(f))
    return { tamil: tamilFirst, rest }
  }, [])\n`
a = a.replace(fontOptBlock, '')
fs.writeFileSync('src/renderer/routes/editor/AutoCaptionPanel.tsx', a)
