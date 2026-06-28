const { transliterateIndic } = require('./src/utils/algorithmicTransliterator');

console.log("=== TRANSLITERATOR TRIE DICTIONARY TESTS ===\n");

// 1. Test basic English to Tamil overriding (ullam -> uLLam -> உள்ளம் instead of உல்லம்)
console.log("Test: ullam (Expected: உள்ளம்)");
console.log("Result:", transliterateIndic("ullam", "en", "ta"));
console.log("");

// 2. Test ழ overriding (pazham -> pazham -> பழம் instead of பஸம்)
console.log("Test: pazham (Expected: பழம்)");
console.log("Result:", transliterateIndic("pazham", "en", "ta"));
console.log("");

// 3. Test ன vs ந compound boundary (thirunaamam -> திருநாமம் instead of திருனாமம்)
console.log("Test: thirunaamam (Expected: திருநாமம்)");
const thiru = transliterateIndic("thirunaamam", "en", "ta");
console.log("Result:", thiru);
if (thiru === "திருநாமம்") {
  console.log("✅ Compound boundary ZWNJ logic worked!");
} else {
  console.log("❌ Failed! ZWNJ logic didn't work. Got:", thiru);
}
console.log("");

// 4. Test other Indic target to ensure Trie works for all
console.log("Test: thirunaamam -> Telugu (Expected: తిరునామమ్)");
console.log("Result:", transliterateIndic("thirunaamam", "en", "te"));
console.log("");

console.log("Test: ullam -> Hindi (Expected: उळ्ळम्)");
console.log("Result:", transliterateIndic("ullam", "en", "hi"));
console.log("");

// 5. Case insensitivity test
console.log("Test: ThIrUnAaMaM (Expected: திருநாமம்)");
console.log("Result:", transliterateIndic("ThIrUnAaMaM", "en", "ta"));
console.log("");

// 6. Test multiple words mixed with exceptions and normal rules
console.log("Test: anbe sivam ullam azhagu (Expected: அன்பே சிவம் உள்ளம் அழகு)");
console.log("Result:", transliterateIndic("anbe sivam ullam azhagu", "en", "ta"));
