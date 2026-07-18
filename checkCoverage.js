const opentype = require('opentype.js');
const path = require('path');
const fs = require('fs');

const fontFile = '1743920620_020.TTF';
const buffer = fs.readFileSync(path.join(__dirname, 'resources', 'fonts', fontFile));
const font = opentype.parse(new Uint8Array(buffer).buffer);

let hasTamil = false;
let hasLatin = false;
for (let i = 0; i < Object.keys(font.glyphs.glyphs).length; i++) {
  const glyph = font.glyphs.glyphs[i];
  if (glyph.unicode >= 0x0B80 && glyph.unicode <= 0x0BFF) {
    hasTamil = true;
  }
  if (glyph.unicode >= 0x0041 && glyph.unicode <= 0x005A) {
    hasLatin = true;
  }
}
console.log('Has Unicode Tamil:', hasTamil);
console.log('Has Latin:', hasLatin);
