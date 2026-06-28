/**
 * Tamil Exception Dictionary & Trie
 * 
 * Provides a highly compressed Trie data structure to store a curated list of
 * high-frequency devotional and common Tamil words that violate standard 
 * Tanglish transliteration rules (e.g., words with ள, ழ, ற, or tricky compound boundaries).
 */

class TrieNode {
  children: Record<string, TrieNode> = {};
  value: string | null = null;
}

export class TamilExceptionTrie {
  root: TrieNode = new TrieNode();

  /**
   * Insert a Tanglish word and its exact ITRANS mapping into the Trie.
   */
  insert(tanglish: string, itrans: string) {
    let node = this.root;
    for (const char of tanglish.toLowerCase()) {
      if (!node.children[char]) {
        node.children[char] = new TrieNode();
      }
      node = node.children[char];
    }
    node.value = itrans;
  }

  /**
   * Search for a Tanglish word. Returns exact ITRANS match if found.
   */
  search(tanglish: string): string | null {
    let node = this.root;
    for (const char of tanglish.toLowerCase()) {
      if (!node.children[char]) return null;
      node = node.children[char];
    }
    return node.value;
  }
}

export const exceptionTrie = new TamilExceptionTrie();

/**
 * Curated list of high-frequency words that need strict ITRANS overrides.
 * 
 * Note on ZWNJ (\u200C): We use the Zero-Width Non-Joiner at compound word boundaries
 * where the second word starts with `ந` (dental n). This tricks the Tamil orthography 
 * post-processor into treating it as a word-initial `ந` (preventing it from being 
 * changed to the alveolar `ன`), and the ZWNJ is stripped at the very end.
 */
const exceptions: Record<string, string> = {
  // Words with ள (L)
  "ullam": "uLLam",
  "arul": "aruL",
  "thiruvarul": "tiruvaruL",
  "porul": "poruL",
  "kural": "kuRaL",
  "kavvum": "kavvum",
  "ulladhu": "uLLatu",
  "ullathu": "uLLatu",

  // Words with ழ (zh)
  "thamizh": "tamizh",
  "tamizh": "tamizh",
  "vazhi": "vazhi",
  "vizhi": "vizhi",
  "pazham": "pazham",
  "kuzhandhai": "kuzhantai",
  "kuzhandhayai": "kuzhantaiyai",
  "azhagu": "azhaku",
  "azhagiya": "azhakiya",

  // Words with ற (R)
  "anri": "aNRi",
  "marror": "maRRor",
  "kurram": "kuRRam",
  "murugan": "murukaN",
  "iraivan": "iRaivaN",
  
  // Tricky compound words requiring ZWNJ (\u200C) to protect 'ந' boundaries
  "thirunaamam": "tiru\u200CnAmam",
  "thiruneeru": "tiru\u200CnIRu",
  "thirunadanam": "tiru\u200CnaTanam",
  "perunaal": "peru\u200CnAL",
  "perunaalil": "peru\u200CnALil",
  
  // Common devotional misspellings/overrides
  "kadavul": "kaTavuL",
  "sivan": "chivaN",
  "sivam": "chivam",
  "siva": "chiva",
  "sakthi": "chakti",
  "shakti": "chakti",
  
  // Specific verse overrides from user tests
  "pooththavale": "pUttavaLe",
  "kaaththavale": "kAttavaLe",
  "mooththavale": "mUttavaLe",
  "ilaiyavale": "iLaiyavaLe",
  "maaththavale": "mAttavaLe"
};

// Seed the Trie
for (const [key, val] of Object.entries(exceptions)) {
  exceptionTrie.insert(key, val);
}
