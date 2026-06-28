import { transliterateIndic } from './src/utils/algorithmicTransliterator.ts';

let originalTamil = `பூத்தவளே புவனம் பதினான்கையும்; பூத்தவண்ணம்
காத்தவளே பின் கரந்தவளே! கறைக் கண்டனுக்கு
மூத்தவளே! என்றும் மூவா முகுந்தற்கு இளையவளே!
மாத்தவளே உன்னை அன்றி மற்றோர் தெய்வம் வந்திப்பதே!`;

console.log(transliterateIndic(originalTamil, 'ta', 'en'));
