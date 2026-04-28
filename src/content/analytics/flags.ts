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

// Slug / display-name aliases → ISO 3166-1 alpha-2. We don't know the exact
// shape richup.io uses for `countryId` on every map (it might be a slug like
// "united-states", a localized name, or already an ISO code), so this table
// covers the most plausible variants. Unknown ids fall through to '' and the
// caller renders without a flag — a missing flag never breaks the UI.
const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  // North America
  'united-states': 'us',
  'united states': 'us',
  'usa': 'us',
  'america': 'us',
  'canada': 'ca',
  'mexico': 'mx',
  // Europe
  'united-kingdom': 'gb',
  'united kingdom': 'gb',
  'uk': 'gb',
  'britain': 'gb',
  'great-britain': 'gb',
  'great britain': 'gb',
  'england': 'gb',
  france: 'fr',
  germany: 'de',
  deutschland: 'de',
  italy: 'it',
  italia: 'it',
  spain: 'es',
  españa: 'es',
  espana: 'es',
  portugal: 'pt',
  netherlands: 'nl',
  holland: 'nl',
  belgium: 'be',
  switzerland: 'ch',
  austria: 'at',
  greece: 'gr',
  poland: 'pl',
  'czech-republic': 'cz',
  'czech republic': 'cz',
  czechia: 'cz',
  hungary: 'hu',
  sweden: 'se',
  norway: 'no',
  denmark: 'dk',
  finland: 'fi',
  ireland: 'ie',
  iceland: 'is',
  romania: 'ro',
  // Asia
  japan: 'jp',
  china: 'cn',
  'south-korea': 'kr',
  'south korea': 'kr',
  korea: 'kr',
  india: 'in',
  thailand: 'th',
  vietnam: 'vn',
  singapore: 'sg',
  indonesia: 'id',
  philippines: 'ph',
  malaysia: 'my',
  turkey: 'tr',
  türkiye: 'tr',
  israel: 'il',
  uae: 'ae',
  'united-arab-emirates': 'ae',
  'united arab emirates': 'ae',
  qatar: 'qa',
  // Oceania
  australia: 'au',
  'new-zealand': 'nz',
  'new zealand': 'nz',
  // Africa
  egypt: 'eg',
  'south-africa': 'za',
  'south africa': 'za',
  morocco: 'ma',
  kenya: 'ke',
  nigeria: 'ng',
  ethiopia: 'et',
  // Latin America
  brazil: 'br',
  brasil: 'br',
  argentina: 'ar',
  chile: 'cl',
  colombia: 'co',
  peru: 'pe',
  uruguay: 'uy',
  cuba: 'cu',
  // Eastern Europe / former USSR
  russia: 'ru',
  ukraine: 'ua',
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
