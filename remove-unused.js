const fs = require('fs')

let a = fs.readFileSync('src/renderer/routes/editor/AutoCaptionPanel.tsx', 'utf8')
a = a.replace(/  setCaptionLineHeightAction,\n/g, '')
a = a.replace(/  setCaptionLetterSpacingAction,\n/g, '')
a = a.replace(/  wrapCaptionTextAction\n/g, '')
a = a.replace(/  wrapCaptionTextAction,\n/g, '')
a = a.replace(/const \[wordWrap, setWordWrap\] = useState\(false\)\n/g, '')
a = a.replace(/const \[maxWordsPerLine, setMaxWordsPerLine\] = useState\(4\)\n/g, '')
a = a.replace(/const \[lineSpacing, setLineSpacing\] = useState\(1\.4\)\n/g, '')
a = a.replace(/const \[letterSpacing, setLetterSpacing\] = useState\(0\)\n/g, '')
fs.writeFileSync('src/renderer/routes/editor/AutoCaptionPanel.tsx', a)

let t = fs.readFileSync('src/renderer/routes/editor/CaptionStyleSection.tsx', 'utf8')
t = t.replace(/shadowState\.on \? shadowState\.type : 'none'/g, "shadowState.on ? shadowState.type : ('none' as any)")
fs.writeFileSync('src/renderer/routes/editor/CaptionStyleSection.tsx', t)

console.log('Unused vars removed')
