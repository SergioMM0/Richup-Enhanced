import { describe, expect, it } from 'vitest';
import type { CityBlock } from '@shared/types';
import {
  countryIdToIso2,
  getCityFlagEmoji,
  iso2ToFlagEmoji,
} from './flags';

const city = (overrides: Partial<CityBlock> = {}): CityBlock => ({
  type: 'city',
  name: 'Test City',
  price: 100,
  ownerId: null,
  isMortgaged: false,
  countryId: '',
  rentPrices: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
  level: 0,
  housePrice: 0,
  hotelPrice: 0,
  ...overrides,
});

describe('iso2ToFlagEmoji', () => {
  it('builds the regional-indicator pair for a valid ISO-2 code', () => {
    expect(iso2ToFlagEmoji('us')).toBe('🇺🇸');
    expect(iso2ToFlagEmoji('FR')).toBe('🇫🇷');
    expect(iso2ToFlagEmoji('jp')).toBe('🇯🇵');
  });

  it('returns empty for invalid input', () => {
    expect(iso2ToFlagEmoji('')).toBe('');
    expect(iso2ToFlagEmoji('u')).toBe('');
    expect(iso2ToFlagEmoji('usa')).toBe('');
    expect(iso2ToFlagEmoji('12')).toBe('');
  });
});

describe('countryIdToIso2', () => {
  it('passes through 2-letter ISO codes', () => {
    expect(countryIdToIso2('us')).toBe('us');
    expect(countryIdToIso2('FR')).toBe('fr');
  });

  it('resolves slug names', () => {
    expect(countryIdToIso2('united-states')).toBe('us');
    expect(countryIdToIso2('united_states')).toBe('us'); // underscore variant
    expect(countryIdToIso2('united-kingdom')).toBe('gb');
    expect(countryIdToIso2('south-korea')).toBe('kr');
  });

  it('resolves plain country names case-insensitively', () => {
    expect(countryIdToIso2('France')).toBe('fr');
    expect(countryIdToIso2('GERMANY')).toBe('de');
    expect(countryIdToIso2('  Italy  ')).toBe('it');
  });

  it('returns empty for unknown ids', () => {
    expect(countryIdToIso2('atlantis')).toBe('');
    expect(countryIdToIso2('')).toBe('');
  });
});

describe('getCityFlagEmoji', () => {
  it('returns the flag for a known countryId slug', () => {
    expect(getCityFlagEmoji(city({ countryId: 'united-states' }))).toBe('🇺🇸');
    expect(getCityFlagEmoji(city({ countryId: 'japan' }))).toBe('🇯🇵');
  });

  it('returns the flag when countryId is already an ISO-2 code', () => {
    expect(getCityFlagEmoji(city({ countryId: 'gb' }))).toBe('🇬🇧');
  });

  it('returns empty string when the countryId is unknown', () => {
    expect(getCityFlagEmoji(city({ countryId: 'mordor' }))).toBe('');
  });
});
