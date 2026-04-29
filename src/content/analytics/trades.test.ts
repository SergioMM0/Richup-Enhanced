import { describe, expect, it } from 'vitest';
import { findTradeOpportunities } from './trades';
import type {
  AirportBlock,
  Block,
  CityBlock,
  GameSettings,
  Participant,
} from '@shared/types';

const settings: GameSettings = {
  maxPlayers: 4,
  canBotsJoin: true,
  isPrivate: false,
  onlyUsers: false,
  payDoubleRentWhenOwnFullSet: true,
  vacationCash: false,
  auction: true,
  noRentPaymentsWhileInPrison: false,
  mortgage: true,
  startingCash: 1500,
  evenBuild: true,
  shufflePlayerOrder: false,
};

const player = (overrides: Partial<Participant> = {}): Participant => ({
  id: 'p1',
  name: 'Alice',
  appearance: '#ff0000',
  isBot: false,
  position: 0,
  money: 2000,
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
  name: 'Generic',
  price: 200,
  ownerId: null,
  isMortgaged: false,
  countryId: 'red',
  rentPrices: { '0': 50, '1': 100, '2': 200, '3': 400, '4': 600, '5': 800 },
  level: 0,
  housePrice: 100,
  hotelPrice: 100,
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

const self = player({ id: 'self', money: 2000 });
const bob = player({ id: 'bob', name: 'Bob', money: 1500 });
const carol = player({ id: 'carol', name: 'Carol', money: 1000 });

describe('findTradeOpportunities — one-away cities', () => {
  it('detects a one-away monopoly with the missing piece on a non-bankrupt opponent', () => {
    const blocks: Block[] = [
      city({ name: 'A', ownerId: 'self', countryId: 'red' }),
      city({ name: 'B', ownerId: 'self', countryId: 'red' }),
      city({ name: 'C', ownerId: 'bob', countryId: 'red' }),
    ];
    const opps = findTradeOpportunities({
      selfId: 'self',
      participants: [self, bob],
      blocks,
      settings,
      selfMoney: self.money,
    });
    expect(opps).toHaveLength(1);
    const o = opps[0]!;
    expect(o.kind).toBe('one-away');
    expect(o.partnerId).toBe('bob');
    expect(o.wantedBlockIndexes).toEqual([2]);
    // rentBefore: bob lands on A ($50) + B ($50) = $100; rentAfter: full set
    // owned by self at level 0 doubles to $100/each across 3 tiles = $300.
    expect(o.rentBefore).toBe(100);
    expect(o.rentAfter).toBe(300);
    expect(o.valueScore).toBe(200);
    expect(o.suggestedCash).toBeGreaterThan(0);
  });

  it('skips when the missing piece owner is bankrupt', () => {
    const dead = player({ id: 'dead', bankruptedAt: '2026-04-28T00:00:00Z' });
    const blocks: Block[] = [
      city({ ownerId: 'self', countryId: 'red' }),
      city({ ownerId: 'self', countryId: 'red' }),
      city({ ownerId: 'dead', countryId: 'red' }),
    ];
    const opps = findTradeOpportunities({
      selfId: 'self',
      participants: [self, dead, bob],
      blocks,
      settings,
      selfMoney: self.money,
    });
    expect(opps).toHaveLength(0);
  });

  it('skips when the missing piece is bank-owned', () => {
    const blocks: Block[] = [
      city({ ownerId: 'self', countryId: 'red' }),
      city({ ownerId: 'self', countryId: 'red' }),
      city({ ownerId: null, countryId: 'red' }),
    ];
    const opps = findTradeOpportunities({
      selfId: 'self',
      participants: [self, bob],
      blocks,
      settings,
      selfMoney: self.money,
    });
    expect(opps).toHaveLength(0);
  });

  it('skips singleton-country sets (1-city groups)', () => {
    const blocks: Block[] = [
      city({ ownerId: 'bob', countryId: 'lonely' }),
    ];
    const opps = findTradeOpportunities({
      selfId: 'self',
      participants: [self, bob],
      blocks,
      settings,
      selfMoney: self.money,
    });
    expect(opps).toHaveLength(0);
  });
});

describe('findTradeOpportunities — mutual swaps', () => {
  it('emits a mutual-swap and suppresses the matching plain one-aways', () => {
    const blocks: Block[] = [
      // Red set: self owns 2/3, bob owns the missing piece.
      city({ name: 'R1', ownerId: 'self', countryId: 'red' }),
      city({ name: 'R2', ownerId: 'self', countryId: 'red' }),
      city({ name: 'R3', ownerId: 'bob', countryId: 'red' }),
      // Blue set: bob owns 2/3, self owns the missing piece.
      city({ name: 'B1', ownerId: 'bob', countryId: 'blue' }),
      city({ name: 'B2', ownerId: 'bob', countryId: 'blue' }),
      city({ name: 'B3', ownerId: 'self', countryId: 'blue' }),
    ];
    const opps = findTradeOpportunities({
      selfId: 'self',
      participants: [self, bob],
      blocks,
      settings,
      selfMoney: self.money,
    });
    const mutuals = opps.filter((o) => o.kind === 'mutual-swap');
    const oneAways = opps.filter((o) => o.kind === 'one-away');
    const singletonOffers = opps.filter((o) => o.kind === 'singleton-offer');
    expect(mutuals).toHaveLength(1);
    expect(oneAways).toHaveLength(0);
    // Singleton offer for B3 should not duplicate the mutual swap's offer.
    expect(singletonOffers).toHaveLength(0);
    const m = mutuals[0]!;
    expect(m.partnerId).toBe('bob');
    expect(m.wantedBlockIndexes).toEqual([2]);
    expect(m.offerBlockIndexes).toEqual([5]);
    expect(m.suggestedCash).toBe(0);
  });
});

describe('findTradeOpportunities — two-away with single seller', () => {
  it('emits when one opponent owns both missing pieces', () => {
    const blocks: Block[] = [
      city({ name: 'A', ownerId: 'self', countryId: 'red' }),
      city({ name: 'B', ownerId: 'bob', countryId: 'red' }),
      city({ name: 'C', ownerId: 'bob', countryId: 'red' }),
    ];
    const opps = findTradeOpportunities({
      selfId: 'self',
      participants: [self, bob],
      blocks,
      settings,
      selfMoney: self.money,
    });
    const twoAways = opps.filter((o) => o.kind === 'two-away');
    expect(twoAways).toHaveLength(1);
    expect(twoAways[0]!.wantedBlockIndexes).toEqual([1, 2]);
    expect(twoAways[0]!.partnerId).toBe('bob');
  });

  it('does not emit when the two missing pieces have different owners', () => {
    const blocks: Block[] = [
      city({ name: 'A', ownerId: 'self', countryId: 'red' }),
      city({ name: 'B', ownerId: 'bob', countryId: 'red' }),
      city({ name: 'C', ownerId: 'carol', countryId: 'red' }),
    ];
    const opps = findTradeOpportunities({
      selfId: 'self',
      participants: [self, bob, carol],
      blocks,
      settings,
      selfMoney: self.money,
    });
    expect(opps.filter((o) => o.kind === 'two-away')).toHaveLength(0);
  });
});

describe('findTradeOpportunities — singleton offers', () => {
  it('emits when self holds the lone missing piece for a partner near-set', () => {
    const blocks: Block[] = [
      city({ name: 'A', ownerId: 'bob', countryId: 'green' }),
      city({ name: 'B', ownerId: 'bob', countryId: 'green' }),
      city({ name: 'C', ownerId: 'self', countryId: 'green' }),
    ];
    const opps = findTradeOpportunities({
      selfId: 'self',
      participants: [self, bob],
      blocks,
      settings,
      selfMoney: self.money,
    });
    const offers = opps.filter((o) => o.kind === 'singleton-offer');
    expect(offers).toHaveLength(1);
    expect(offers[0]!.partnerId).toBe('bob');
    expect(offers[0]!.offerBlockIndexes).toEqual([2]);
    expect(offers[0]!.suggestedCash).toBeGreaterThan(0);
  });
});

describe('findTradeOpportunities — airports', () => {
  it('targets only opponent-owned airports and computes self rent uplift', () => {
    const blocks: Block[] = [
      airport({ name: 'JFK', ownerId: 'self' }),
      airport({ name: 'LAX', ownerId: 'bob' }),
      airport({ name: 'ORD', ownerId: 'bob' }),
      airport({ name: 'ATL', ownerId: null }),
    ];
    const opps = findTradeOpportunities({
      selfId: 'self',
      participants: [self, bob],
      blocks,
      settings,
      selfMoney: self.money,
    });
    const airports = opps.filter((o) => o.kind === 'airport');
    // Self owns 1 airport; bob owns 2 (LAX, ORD); ATL is bank-owned.
    expect(airports).toHaveLength(2);
    const targets = airports.map((o) => o.wantedBlockIndexes[0]).sort();
    expect(targets).toEqual([1, 2]);
    for (const o of airports) expect(o.partnerId).toBe('bob');
    // rentBefore: self owns 1 airport, rent[0] = $25. rentAfter: self owns 2
    // airports, rent[1] = $50 each → total $100 across both self-owned tiles.
    for (const o of airports) {
      expect(o.rentBefore).toBe(25);
      expect(o.rentAfter).toBe(100);
      expect(o.valueScore).toBe(75);
    }
  });

  it('skips airport opportunities entirely when self owns no airports', () => {
    const blocks: Block[] = [
      airport({ name: 'JFK', ownerId: 'bob' }),
      airport({ name: 'LAX', ownerId: 'bob' }),
    ];
    const opps = findTradeOpportunities({
      selfId: 'self',
      participants: [self, bob],
      blocks,
      settings,
      selfMoney: self.money,
    });
    expect(opps.filter((o) => o.kind === 'airport')).toHaveLength(0);
  });
});

describe('findTradeOpportunities — sorting & limits', () => {
  it('places mutual-swap above one-away regardless of valueScore', () => {
    const blocks: Block[] = [
      // Mutual swap on blue/red between self and bob.
      city({ name: 'R1', ownerId: 'self', countryId: 'red' }),
      city({ name: 'R2', ownerId: 'self', countryId: 'red' }),
      city({ name: 'R3', ownerId: 'bob', countryId: 'red' }),
      city({ name: 'B1', ownerId: 'bob', countryId: 'blue' }),
      city({ name: 'B2', ownerId: 'bob', countryId: 'blue' }),
      city({ name: 'B3', ownerId: 'self', countryId: 'blue' }),
      // Plain one-away with carol on green at HIGHER rent values.
      city({
        name: 'G1',
        ownerId: 'self',
        countryId: 'green',
        rentPrices: { '0': 500, '1': 1000, '2': 2000, '3': 4000, '4': 6000, '5': 8000 },
      }),
      city({
        name: 'G2',
        ownerId: 'self',
        countryId: 'green',
        rentPrices: { '0': 500, '1': 1000, '2': 2000, '3': 4000, '4': 6000, '5': 8000 },
      }),
      city({
        name: 'G3',
        ownerId: 'carol',
        countryId: 'green',
        rentPrices: { '0': 500, '1': 1000, '2': 2000, '3': 4000, '4': 6000, '5': 8000 },
      }),
    ];
    const opps = findTradeOpportunities({
      selfId: 'self',
      participants: [self, bob, carol],
      blocks,
      settings,
      selfMoney: self.money,
    });
    expect(opps[0]!.kind).toBe('mutual-swap');
    // Even though the green plain one-away has a far larger valueScore, the
    // group-priority sort still places it after the mutual-swap.
    expect(opps[1]!.kind).toBe('one-away');
  });

  it('respects suggestedCash cap of 0.4 × selfMoney', () => {
    const blocks: Block[] = [
      city({
        name: 'A',
        ownerId: 'self',
        countryId: 'red',
        // A huge rent table inflates valueScore so the cap is the binding
        // constraint rather than upperFromValue / upperFromPrice.
        rentPrices: { '0': 5000, '1': 10000, '2': 20000, '3': 40000, '4': 60000, '5': 80000 },
      }),
      city({
        name: 'B',
        ownerId: 'self',
        countryId: 'red',
        rentPrices: { '0': 5000, '1': 10000, '2': 20000, '3': 40000, '4': 60000, '5': 80000 },
      }),
      city({
        name: 'C',
        ownerId: 'bob',
        countryId: 'red',
        price: 1000,
        rentPrices: { '0': 5000, '1': 10000, '2': 20000, '3': 40000, '4': 60000, '5': 80000 },
      }),
    ];
    const constrainedSelf = player({ id: 'self', money: 1000 });
    const opps = findTradeOpportunities({
      selfId: 'self',
      participants: [constrainedSelf, bob],
      blocks,
      settings,
      selfMoney: constrainedSelf.money,
    });
    expect(opps).toHaveLength(1);
    expect(opps[0]!.suggestedCash).toBeLessThanOrEqual(
      Math.floor(constrainedSelf.money * 0.4),
    );
  });

  it('caps total opportunities at 12', () => {
    const blocks: Block[] = [];
    // Build 15 distinct one-away opportunities (15 different countries).
    for (let i = 0; i < 15; i++) {
      blocks.push(
        city({ name: `${i}A`, ownerId: 'self', countryId: `c${i}` }),
        city({ name: `${i}B`, ownerId: 'self', countryId: `c${i}` }),
        city({ name: `${i}C`, ownerId: 'bob', countryId: `c${i}` }),
      );
    }
    const opps = findTradeOpportunities({
      selfId: 'self',
      participants: [self, bob],
      blocks,
      settings,
      selfMoney: self.money,
    });
    expect(opps).toHaveLength(12);
  });
});

describe('findTradeOpportunities — guards', () => {
  it('returns empty when self is not in participants', () => {
    const blocks: Block[] = [
      city({ ownerId: 'bob', countryId: 'red' }),
    ];
    const opps = findTradeOpportunities({
      selfId: 'ghost',
      participants: [bob],
      blocks,
      settings,
      selfMoney: 0,
    });
    expect(opps).toEqual([]);
  });

  it('returns empty when self is bankrupt', () => {
    const broke = player({ id: 'self', bankruptedAt: '2026-04-29T00:00:00Z' });
    const blocks: Block[] = [
      city({ ownerId: 'self', countryId: 'red' }),
      city({ ownerId: 'self', countryId: 'red' }),
      city({ ownerId: 'bob', countryId: 'red' }),
    ];
    const opps = findTradeOpportunities({
      selfId: 'self',
      participants: [broke, bob],
      blocks,
      settings,
      selfMoney: 0,
    });
    expect(opps).toEqual([]);
  });

  it('returns empty when there are no live opponents', () => {
    const blocks: Block[] = [
      city({ ownerId: 'self', countryId: 'red' }),
      city({ ownerId: 'self', countryId: 'red' }),
    ];
    const opps = findTradeOpportunities({
      selfId: 'self',
      participants: [self],
      blocks,
      settings,
      selfMoney: self.money,
    });
    expect(opps).toEqual([]);
  });
});
