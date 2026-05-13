import { describe, expect, it } from 'vitest';
import type { Block, CityBlock, Trade } from '@shared/types';
import { findDisappearedTrades, inferResolution } from './history-view';

const makeTrade = (id: string, overrides: Partial<Trade> = {}): Trade => ({
  id,
  initiatorId: 'p1',
  recipientId: 'p2',
  status: 'pending',
  negotiationCount: 0,
  watcherIds: [],
  note: null,
  initiatorOffer: {
    money: 0,
    propertyIndices: [],
    mortgagedPropertiesIndexes: [],
    pardonCards: [],
  },
  recipientOffer: {
    money: 0,
    propertyIndices: [],
    mortgagedPropertiesIndexes: [],
    pardonCards: [],
  },
  ...overrides,
});

const city = (overrides: Partial<CityBlock> = {}): CityBlock => ({
  type: 'city',
  name: 'Generic',
  price: 200,
  ownerId: null,
  isMortgaged: false,
  countryId: 'red',
  rentPrices: { 0: 10, 1: 50, 2: 150, 3: 450, 4: 625, 5: 750 },
  level: 0,
  housePrice: 100,
  hotelPrice: 100,
  ...overrides,
});

const asPrev = (trades: Trade[]): Map<string, Trade> =>
  new Map(trades.map((t) => [t.id, t]));

const idsOf = (trades: Trade[]): Set<string> =>
  new Set(trades.map((t) => t.id));

describe('findDisappearedTrades', () => {
  it('returns trades present in prev but not in currentIds', () => {
    const a = makeTrade('a');
    const b = makeTrade('b');
    const out = findDisappearedTrades(asPrev([a, b]), idsOf([b]));
    expect(out).toEqual([a]);
  });

  it('returns nothing when all prev ids still present', () => {
    const a = makeTrade('a');
    expect(findDisappearedTrades(asPrev([a]), idsOf([a]))).toEqual([]);
  });

  it('handles empty prev', () => {
    expect(findDisappearedTrades(new Map(), idsOf([makeTrade('a')]))).toEqual([]);
  });
});

describe('inferResolution', () => {
  const blocks: Block[] = Array.from({ length: 40 }, (_, i) => city({ name: `tile-${i}` }));

  it('returns counter-offered when same-pair trade exists in current', () => {
    const trade = makeTrade('a', { initiatorId: 'p1', recipientId: 'p2' });
    const replacement = makeTrade('b', { initiatorId: 'p1', recipientId: 'p2' });
    expect(
      inferResolution(trade, [replacement], new Map(), blocks),
    ).toBe('counter-offered');
  });

  it('returns counter-offered when same-pair trade exists with swapped roles', () => {
    const trade = makeTrade('a', { initiatorId: 'p1', recipientId: 'p2' });
    const replacement = makeTrade('b', { initiatorId: 'p2', recipientId: 'p1' });
    expect(
      inferResolution(trade, [replacement], new Map(), blocks),
    ).toBe('counter-offered');
  });

  it('returns accepted when an initiator-offered property flipped to recipient', () => {
    const trade = makeTrade('a', {
      initiatorId: 'p1',
      recipientId: 'p2',
      initiatorOffer: {
        money: 0,
        propertyIndices: [5],
        mortgagedPropertiesIndexes: [],
        pardonCards: [],
      },
    });
    const prevOwners = new Map<number, string | null>([[5, 'p1']]);
    const currentBlocks = blocks.map((b, i) =>
      i === 5 ? city({ ownerId: 'p2' }) : b,
    );
    expect(inferResolution(trade, [], prevOwners, currentBlocks)).toBe(
      'accepted',
    );
  });

  it('returns accepted when a recipient-offered property flipped to initiator', () => {
    const trade = makeTrade('a', {
      initiatorId: 'p1',
      recipientId: 'p2',
      recipientOffer: {
        money: 0,
        propertyIndices: [12],
        mortgagedPropertiesIndexes: [],
        pardonCards: [],
      },
    });
    const prevOwners = new Map<number, string | null>([[12, 'p2']]);
    const currentBlocks = blocks.map((b, i) =>
      i === 12 ? city({ ownerId: 'p1' }) : b,
    );
    expect(inferResolution(trade, [], prevOwners, currentBlocks)).toBe(
      'accepted',
    );
  });

  it('returns declined when ownership did not change and no replacement exists', () => {
    const trade = makeTrade('a', {
      initiatorId: 'p1',
      recipientId: 'p2',
      initiatorOffer: {
        money: 0,
        propertyIndices: [5],
        mortgagedPropertiesIndexes: [],
        pardonCards: [],
      },
    });
    const prevOwners = new Map<number, string | null>([[5, 'p1']]);
    const currentBlocks = blocks.map((b, i) =>
      i === 5 ? city({ ownerId: 'p1' }) : b,
    );
    expect(inferResolution(trade, [], prevOwners, currentBlocks)).toBe(
      'declined',
    );
  });

  it('ignores ownership changes between unrelated participants', () => {
    // Property flipped from p3 to p4 — neither is in this trade, so it must
    // be a coincident transaction, not this trade being accepted.
    const trade = makeTrade('a', {
      initiatorId: 'p1',
      recipientId: 'p2',
      initiatorOffer: {
        money: 0,
        propertyIndices: [5],
        mortgagedPropertiesIndexes: [],
        pardonCards: [],
      },
    });
    const prevOwners = new Map<number, string | null>([[5, 'p3']]);
    const currentBlocks = blocks.map((b, i) =>
      i === 5 ? city({ ownerId: 'p4' }) : b,
    );
    expect(inferResolution(trade, [], prevOwners, currentBlocks)).toBe(
      'declined',
    );
  });

  it('considers a trade with the same id as itself, not as a replacement', () => {
    const trade = makeTrade('a', { initiatorId: 'p1', recipientId: 'p2' });
    // currentTrades still containing the same id (shouldn't happen because
    // the caller only passes disappeared trades, but defensive).
    expect(inferResolution(trade, [trade], new Map(), blocks)).toBe(
      'declined',
    );
  });
});
