import { describe, expect, it } from 'vitest';
import {
  calcParticipantNetWorth,
  formatMoney,
  getParticipantHoldings,
  rankParticipants,
} from './player';
import type {
  AirportBlock,
  Block,
  CityBlock,
  CompanyBlock,
  CornerBlock,
  Participant,
} from '@shared/types';

const player = (overrides: Partial<Participant> = {}): Participant => ({
  id: 'p1',
  name: 'Alice',
  appearance: '#ff0000',
  isBot: false,
  position: 0,
  money: 1500,
  bankruptedAt: null,
  debtTo: null,
  connectivity: 'stable',
  connectivityKickAt: null,
  timedVotekickAt: null,
  votekickedAt: null,
  ...overrides,
});

const city = (overrides: Partial<CityBlock> = {}): CityBlock => ({
  type: 'city',
  name: 'Boardwalk',
  price: 400,
  ownerId: null,
  isMortgaged: false,
  countryId: 'dark-blue',
  rentPrices: { '0': 50, '1': 200, '2': 600, '3': 1400, '4': 1700, '5': 2000 },
  level: 0,
  housePrice: 200,
  hotelPrice: 200,
  ...overrides,
});

const airport = (overrides: Partial<AirportBlock> = {}): AirportBlock => ({
  type: 'airport',
  name: 'JFK',
  price: 200,
  ownerId: null,
  isMortgaged: false,
  rentPrices: [25, 50, 100, 200],
  ...overrides,
});

const company = (overrides: Partial<CompanyBlock> = {}): CompanyBlock => ({
  type: 'company',
  name: 'Electric Co',
  price: 150,
  ownerId: null,
  isMortgaged: false,
  ...overrides,
});

const corner: CornerBlock = {
  type: 'corner',
  name: 'Go',
  cornerType: 'go',
};

describe('calcParticipantNetWorth', () => {
  it('returns just cash when no properties owned', () => {
    const p = player({ money: 1500 });
    const r = calcParticipantNetWorth(p, [corner]);
    expect(r).toEqual({
      cash: 1500,
      propertyValue: 0,
      lockedInSets: 0,
      total: 1500,
    });
  });

  it('counts a single bare-owned city at half price (mortgage value)', () => {
    const p = player({ money: 1300 });
    const blocks: Block[] = [city({ ownerId: 'p1', price: 400, level: 0 })];
    const r = calcParticipantNetWorth(p, blocks);
    expect(r.propertyValue).toBe(200);
    expect(r.total).toBe(1500);
  });

  it('contributes 0 for mortgaged property', () => {
    const p = player({ money: 1500 });
    const blocks: Block[] = [
      city({ ownerId: 'p1', price: 400, isMortgaged: true }),
    ];
    expect(calcParticipantNetWorth(p, blocks).propertyValue).toBe(0);
  });

  it('adds half the house build cost for cities with 1-4 houses', () => {
    const p = player({ money: 0 });
    for (const lvl of [1, 2, 3, 4] as const) {
      const blocks: Block[] = [
        city({ ownerId: 'p1', price: 400, level: lvl, housePrice: 200 }),
      ];
      const r = calcParticipantNetWorth(p, blocks);
      expect(r.propertyValue).toBe(200 + 100 * lvl);
    }
  });

  it('adds half of (4 houses + hotel) at level 5', () => {
    const p = player({ money: 0 });
    const blocks: Block[] = [
      city({
        ownerId: 'p1',
        price: 400,
        level: 5,
        housePrice: 200,
        hotelPrice: 200,
      }),
    ];
    const r = calcParticipantNetWorth(p, blocks);
    expect(r.propertyValue).toBe(200 + (200 * 4 + 200) / 2);
  });

  it('values airports and companies at half their price', () => {
    const p = player({ money: 0 });
    const blocks: Block[] = [
      airport({ ownerId: 'p1', price: 200 }),
      company({ ownerId: 'p1', price: 150 }),
    ];
    expect(calcParticipantNetWorth(p, blocks).propertyValue).toBe(175);
  });

  it('ignores properties owned by other players', () => {
    const p = player({ id: 'p1', money: 0 });
    const blocks: Block[] = [
      city({ ownerId: 'p2', price: 400 }),
      airport({ ownerId: null, price: 200 }),
    ];
    expect(calcParticipantNetWorth(p, blocks).propertyValue).toBe(0);
  });

  it('skips non-purchasable blocks (corner, bonus, tax)', () => {
    const p = player({ money: 100 });
    const blocks: Block[] = [
      corner,
      { type: 'bonus', name: 'Treasure', bonusType: 'treasure' },
      { type: 'tax', name: 'Earnings Tax' },
    ];
    expect(calcParticipantNetWorth(p, blocks).propertyValue).toBe(0);
  });

  it('handles a mixed portfolio', () => {
    const p = player({ id: 'p1', money: 500 });
    const blocks: Block[] = [
      city({ ownerId: 'p1', price: 400, level: 3, housePrice: 200, hotelPrice: 200 }),
      city({ ownerId: 'p1', price: 200, isMortgaged: true }),
      airport({ ownerId: 'p1', price: 200 }),
      company({ ownerId: 'p2', price: 150 }),
      corner,
    ];
    const r = calcParticipantNetWorth(p, blocks);
    // city w/ 3 houses: 400/2 + (200*3)/2 = 200 + 300 = 500
    // mortgaged city: 0
    // airport: 200/2 = 100
    // total prop: 600; total: 1100
    expect(r.propertyValue).toBe(600);
    expect(r.cash).toBe(500);
    expect(r.total).toBe(1100);
  });
});

describe('formatMoney', () => {
  it('formats integers with thousand separators and a leading $', () => {
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(1500)).toBe('$1,500');
    expect(formatMoney(1234567)).toBe('$1,234,567');
  });

  it('rounds non-integers', () => {
    expect(formatMoney(99.4)).toBe('$99');
    expect(formatMoney(99.6)).toBe('$100');
  });
});

describe('getParticipantHoldings', () => {
  it('returns empty buckets when the player owns nothing', () => {
    const h = getParticipantHoldings('p1', [corner]);
    expect(h.cities).toEqual([]);
    expect(h.airports).toEqual([]);
    expect(h.companies).toEqual([]);
    expect(h.citiesByCountry.size).toBe(0);
    expect(h.completedSets.size).toBe(0);
    expect(h.totalProperties).toBe(0);
    expect(h.mortgagedCount).toBe(0);
    expect(h.developedCount).toBe(0);
  });

  it('groups owned cities by country and ignores other owners', () => {
    const blocks: Block[] = [
      city({ name: 'A', ownerId: 'p1', countryId: 'red' }),
      city({ name: 'B', ownerId: 'p1', countryId: 'red' }),
      city({ name: 'C', ownerId: 'p1', countryId: 'blue' }),
      city({ name: 'D', ownerId: 'p2', countryId: 'red' }),
      airport({ name: 'JFK', ownerId: 'p1' }),
      company({ name: 'Elec', ownerId: 'p1' }),
    ];
    const h = getParticipantHoldings('p1', blocks);
    expect(h.cities.map((c) => c.name)).toEqual(['A', 'B', 'C']);
    expect(h.citiesByCountry.get('red')?.map((c) => c.name)).toEqual(['A', 'B']);
    expect(h.citiesByCountry.get('blue')?.map((c) => c.name)).toEqual(['C']);
    expect(h.airports).toHaveLength(1);
    expect(h.companies).toHaveLength(1);
    expect(h.totalProperties).toBe(5);
  });

  it('flags completed sets (≥2 cities all owned by the player)', () => {
    const blocks: Block[] = [
      city({ ownerId: 'p1', countryId: 'red' }),
      city({ ownerId: 'p1', countryId: 'red' }),
      city({ ownerId: 'p1', countryId: 'blue' }),
      city({ ownerId: 'p2', countryId: 'blue' }),
    ];
    const h = getParticipantHoldings('p1', blocks);
    expect(h.completedSets.has('red')).toBe(true);
    expect(h.completedSets.has('blue')).toBe(false);
  });

  it('counts mortgaged and developed cities', () => {
    const blocks: Block[] = [
      city({ ownerId: 'p1', level: 0 }),
      city({ ownerId: 'p1', level: 3 }),
      city({ ownerId: 'p1', level: 5 }),
      city({ ownerId: 'p1', isMortgaged: true, level: 0 }),
      airport({ ownerId: 'p1', isMortgaged: true }),
    ];
    const h = getParticipantHoldings('p1', blocks);
    expect(h.developedCount).toBe(2);
    expect(h.mortgagedCount).toBe(2);
  });
});

describe('rankParticipants', () => {
  it('sorts by total net worth descending and assigns 1-based rank', () => {
    const a = player({ id: 'a', name: 'A', money: 100 });
    const b = player({ id: 'b', name: 'B', money: 500 });
    const c = player({ id: 'c', name: 'C', money: 300 });
    const ranked = rankParticipants([a, b, c], []);
    expect(ranked.map((r) => r.participant.id)).toEqual(['b', 'c', 'a']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('includes property value in the ranking, not just cash', () => {
    const rich = player({ id: 'rich', money: 100 });
    const poor = player({ id: 'poor', money: 800 });
    // rich owns one bare $400 city → liquidation 200 → total 300
    // poor → total 800
    const blocks: Block[] = [city({ ownerId: 'rich', price: 400 })];
    const ranked = rankParticipants([rich, poor], blocks);
    expect(ranked[0]!.participant.id).toBe('poor');
    expect(ranked[0]!.breakdown.total).toBe(800);
    expect(ranked[1]!.breakdown.total).toBe(300);
  });

  it('gives tied players the same rank and skips the next slot (1, 2, 2, 4)', () => {
    const a = player({ id: 'a', money: 1000 });
    const b = player({ id: 'b', money: 500 });
    const c = player({ id: 'c', money: 500 });
    const d = player({ id: 'd', money: 100 });
    const ranked = rankParticipants([a, b, c, d], []);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it('omits bankrupt players entirely', () => {
    const alive = player({ id: 'alive', money: 100 });
    const broke = player({
      id: 'broke',
      money: 0,
      bankruptedAt: '2026-04-28T12:00:00Z',
    });
    const ranked = rankParticipants([alive, broke], []);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.participant.id).toBe('alive');
  });

  it('attaches each player’s holdings alongside the breakdown', () => {
    const p = player({ id: 'p1', money: 0 });
    const blocks: Block[] = [
      city({ ownerId: 'p1', countryId: 'red' }),
      city({ ownerId: 'p1', countryId: 'red' }),
    ];
    const ranked = rankParticipants([p], blocks);
    expect(ranked[0]!.holdings.cities).toHaveLength(2);
    expect(ranked[0]!.holdings.completedSets.has('red')).toBe(true);
  });
});
