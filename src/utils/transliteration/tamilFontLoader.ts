/**
 * tamilFontLoader.ts
 *
 * Dedicated typography loader for grand, cinematic Tamil calligraphic
 * and manuscript fonts. Handles runtime loading of both Google Web Fonts
 * and custom local fonts from `/fonts/` with ligature-safe browser memory verification.
 */



// Specific Tamil fonts as requested
const TAMIL_GOOGLE_FONTS = [
  {
    family: 'Kavivanar',
    url: 'https://fonts.googleapis.com/css2?family=Kavivanar&display=swap'
  },
  {
    family: 'Arima Madurai',
    url: 'https://fonts.googleapis.com/css2?family=Arima+Madurai:wght@400;700&display=swap'
  },
  {
    family: 'Tiro Tamil',
    url: 'https://fonts.googleapis.com/css2?family=Tiro+Tamil&display=swap'
  }
];

const TAMIL_LOCAL_FONTS = [
  {
    family: 'SaiIndira',
    filename: 'SaiIndira',
    weights: ['400', '700']
  },
  {
    family: 'Kamban',
    filename: 'Kamban',
    weights: ['400', '700']
  },
  {
    family: 'Valluvan',
    filename: 'Valluvan',
    weights: ['400', '700']
  }
];

/**
 * Injects Google Web Fonts stylesheets into document head if not already present.
 */
function injectGoogleTamilFonts(): void {
  TAMIL_GOOGLE_FONTS.forEach((font) => {
    const linkId = `gf-tamil-${font.family.replace(/\s+/g, '-').toLowerCase()}`;
    if (!document.getElementById(linkId)) {
      const link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href = font.url;
      document.head.appendChild(link);
    }
  });
}

/**
 * Generates and appends @font-face CSS to document head for local Tamil calligraphy fonts.
 */
function injectLocalTamilFonts(): void {
  const styleId = 'local-tamil-calligraphy-fonts';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;

  let css = '';
  TAMIL_LOCAL_FONTS.forEach((font) => {
    font.weights.forEach((weight) => {
      // Direct paths to WOFF2/TTF in public/fonts/ (served at /fonts/ by Vite)
      css += `
@font-face {
  font-family: '${font.family}';
  src: url('/fonts/${font.filename}-${weight}.woff2') format('woff2'),
       url('/fonts/${font.filename}-${weight}.ttf') format('truetype'),
       url('/fonts/${font.filename}.woff2') format('woff2'),
       url('/fonts/${font.filename}.ttf') format('truetype');
  font-weight: ${weight};
  font-style: normal;
  font-display: swap;
}
`;
    });
  });

  style.appendChild(document.createTextNode(css));
  document.head.appendChild(style);
}

/**
 * Core loading function. Injects all cinematic/calligraphic Google and local fonts,
 * and waits for all of them to be fully loaded into the browser memory before resolving.
 */
export async function loadTamilCalligraphyFonts(): Promise<void> {
  // 1. Inject styling rules
  injectGoogleTamilFonts();
  injectLocalTamilFonts();

  // Give the browser a micro-moment to parse injected style tags
  await new Promise<void>((resolve) => setTimeout(resolve, 50));

  // 2. Wait until browser signals that all font faces are ready.
  // Using document.fonts.ready ensures we don't start rendering on canvas
  // before complex ligatures (புள்ளிகள், உயிர்மெய் எழுத்துக்கள்) are ready.
  try {
    await document.fonts.ready;

    // Specifically probe the critical calligraphic fonts to force load verification
    const probeText = 'அன்பே சிவம் கம்பர் வள்ளுவர்';
    const loadPromises: Promise<any>[] = [];

    // Probe Google Tamil fonts
    TAMIL_GOOGLE_FONTS.forEach((f) => {
      loadPromises.push(document.fonts.load(`400 120px '${f.family}'`, probeText));
    });

    // Probe Local Tamil fonts
    TAMIL_LOCAL_FONTS.forEach((f) => {
      f.weights.forEach((w) => {
        loadPromises.push(document.fonts.load(`${w} 120px '${f.family}'`, probeText));
      });
    });

    await Promise.all(loadPromises);
    console.info('[TamilFontLoader] All cinematic Tamil calligraphic fonts verified in memory.');
  } catch (err) {
    console.warn('[TamilFontLoader] Error while ensuring fonts loaded: ', err);
  }
}
