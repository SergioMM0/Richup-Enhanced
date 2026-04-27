import { describe, expect, it } from 'vitest';
import { calcParticipantNetWorth, formatMoney } from './player';
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
    expect(r).toEqual({ cash: 1500, propertyValue: 0, total: 1500 });
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
