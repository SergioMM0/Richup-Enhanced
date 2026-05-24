import type { CityBlock } from '@shared/types';

// Convert an ISO 3166-1 alpha-2 code (e.g. "us", "fr") into the corresponding
// flag emoji. Flag emojis are formed by pairing two regional-indicator
// codepoints (U+1F1E6..U+1F1FF), one per letter, so this is purely
// algorithmic — no per-country emoji constants needed.
export function iso2ToFlagEmoji(iso2: string): string {
  const code = iso2.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  const A = 'A'.charCodeAt(0);
  const REGIONAL_INDICATOR_A = 0x1f1e6;
  const first = REGIONAL_INDICATOR_A + (code.charCodeAt(0) - A);
  const second = REGIONAL_INDICATOR_A + (code.charCodeAt(1) - A);
  return String.fromCodePoint(first, second);
}

// Slug / display-name / demonym aliases → ISO 3166-1 alpha-2. richup.io's
// "Cities of the World" maps use adjective demonyms as the countryId
// (e.g. "american", "german", "israeli") rather than slugs or country names,
// but other maps may use slugs or ISO codes — we cover all three forms.
// Unknown ids fall through to '' and the caller renders without a flag —
// a missing flag never breaks the UI.
const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  // North America
  'united-states': 'us',
  'united states': 'us',
  'usa': 'us',
  'america': 'us',
  'american': 'us',
  'canada': 'ca',
  'canadian': 'ca',
  'mexico': 'mx',
  'mexican': 'mx',
  // Europe
  'united-kingdom': 'gb',
  'united kingdom': 'gb',
  'uk': 'gb',
  'britain': 'gb',
  'british': 'gb',
  'great-britain': 'gb',
  'great britain': 'gb',
  'england': 'gb',
  'english': 'gb',
  france: 'fr',
  french: 'fr',
  germany: 'de',
  german: 'de',
  deutschland: 'de',
  italy: 'it',
  italian: 'it',
  italia: 'it',
  spain: 'es',
  spanish: 'es',
  españa: 'es',
  espana: 'es',
  portugal: 'pt',
  portuguese: 'pt',
  netherlands: 'nl',
  dutch: 'nl',
  holland: 'nl',
  belgium: 'be',
  belgian: 'be',
  switzerland: 'ch',
  swiss: 'ch',
  austria: 'at',
  austrian: 'at',
  greece: 'gr',
  greek: 'gr',
  poland: 'pl',
  polish: 'pl',
  'czech-republic': 'cz',
  'czech republic': 'cz',
  czechia: 'cz',
  czech: 'cz',
  hungary: 'hu',
  hungarian: 'hu',
  sweden: 'se',
  swedish: 'se',
  norway: 'no',
  norwegian: 'no',
  denmark: 'dk',
  danish: 'dk',
  finland: 'fi',
  finnish: 'fi',
  ireland: 'ie',
  irish: 'ie',
  iceland: 'is',
  icelandic: 'is',
  romania: 'ro',
  romanian: 'ro',
  // Asia
  japan: 'jp',
  japanese: 'jp',
  china: 'cn',
  chinese: 'cn',
  'south-korea': 'kr',
  'south korea': 'kr',
  korea: 'kr',
  korean: 'kr',
  india: 'in',
  indian: 'in',
  thailand: 'th',
  thai: 'th',
  vietnam: 'vn',
  vietnamese: 'vn',
  singapore: 'sg',
  singaporean: 'sg',
  indonesia: 'id',
  indonesian: 'id',
  philippines: 'ph',
  filipino: 'ph',
  malaysia: 'my',
  malaysian: 'my',
  turkey: 'tr',
  turkish: 'tr',
  türkiye: 'tr',
  israel: 'il',
  israeli: 'il',
  uae: 'ae',
  'united-arab-emirates': 'ae',
  'united arab emirates': 'ae',
  emirati: 'ae',
  qatar: 'qa',
  qatari: 'qa',
  // Oceania
  australia: 'au',
  australian: 'au',
  'new-zealand': 'nz',
  'new zealand': 'nz',
  // Africa
  egypt: 'eg',
  egyptian: 'eg',
  'south-africa': 'za',
  'south africa': 'za',
  'south-african': 'za',
  morocco: 'ma',
  moroccan: 'ma',
  kenya: 'ke',
  kenyan: 'ke',
  nigeria: 'ng',
  nigerian: 'ng',
  ethiopia: 'et',
  ethiopian: 'et',
  // Latin America
  brazil: 'br',
  brasil: 'br',
  brazilian: 'br',
  argentina: 'ar',
  argentinian: 'ar',
  argentine: 'ar',
  chile: 'cl',
  chilean: 'cl',
  colombia: 'co',
  colombian: 'co',
  peru: 'pe',
  peruvian: 'pe',
  uruguay: 'uy',
  uruguayan: 'uy',
  cuba: 'cu',
  cuban: 'cu',
  // Eastern Europe / former USSR
  russia: 'ru',
  russian: 'ru',
  ukraine: 'ua',
  ukrainian: 'ua',
};

function normalize(id: string): string {
  return id.trim().toLowerCase().replace(/_/g, '-');
}

// Resolve a `countryId` string (slug, name, or ISO-2) to an ISO 3166-1 alpha-2
// code, or '' if we don't recognize it. Exposed separately so future callers
// (e.g. country labels, sort-by-region) can reuse the same lookup without
// going through the flag emoji.
export function countryIdToIso2(countryId: string): string {
  const id = normalize(countryId);
  if (!id) return '';
  // 2-letter values are treated as ISO-2 directly when they're plausibly so —
  // the regional-indicator math will produce a flag for any A-Z pair.
  if (/^[a-z]{2}$/.test(id)) return id;
  return COUNTRY_NAME_TO_ISO[id] ?? '';
}

// Public helper: returns the flag emoji for a city, or '' if the country
// can't be resolved. Takes the whole CityBlock so we can extend with
// name-based heuristics later without changing the call sites.
export function getCityFlagEmoji(city: CityBlock): string {
  const iso = countryIdToIso2(city.countryId);
  return iso ? iso2ToFlagEmoji(iso) : '';
}
