import { describe, expect, it } from 'vitest';
import type { Trade } from '@shared/types';
import { diffTrades } from './history-view';

const makeTrade = (id: string, overrides: Partial<Trade> = {}): Trade => ({
  id,
  initiatorId: 'p1',
  recipientId: 'p2',
  status: 'pending',
  negotiationCount: 0,
  watcherIds: [],
  note: null,
  initiatorOffer: { money: 0, blockIndexes: [] },
  recipientOffer: { money: 0, blockIndexes: [] },
  ...overrides,
});

const asPrev = (trades: Trade[]): Map<string, Trade> =>
  new Map(trades.map((t) => [t.id, t]));

const idsOf = (trades: Trade[]): Set<string> =>
  new Set(trades.map((t) => t.id));

describe('diffTrades', () => {
  it('returns nothing when no trade ids disappeared', () => {
    const t1 = makeTrade('t1');
    const result = diffTrades({
      prev: asPrev([t1]),
      currentIds: idsOf([t1]),
      prevCount: 0,
      currentCount: 0,
    });
    expect(result).toEqual([]);
  });

  it('returns nothing on a fresh observation (prevCount null)', () => {
    // No prev trades exist either — first tick, nothing to diff.
    const result = diffTrades({
      prev: asPrev([]),
      currentIds: idsOf([makeTrade('t1')]),
      prevCount: null,
      currentCount: 0,
    });
    expect(result).toEqual([]);
  });

  it('labels a disappeared trade accepted when tradesCount increments', () => {
    const t1 = makeTrade('t1');
    const result = diffTrades({
      prev: asPrev([t1]),
      currentIds: idsOf([]),
      prevCount: 3,
      currentCount: 4,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ trade: t1, outcome: 'accepted' });
  });

  it('labels a disappeared trade declined when tradesCount is unchanged', () => {
    const t1 = makeTrade('t1');
    const result = diffTrades({
      prev: asPrev([t1]),
      currentIds: idsOf([]),
      prevCount: 3,
      currentCount: 3,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ trade: t1, outcome: 'declined' });
  });

  it('credits acceptance budget greedily when two trades resolve on the same tick', () => {
    const a = makeTrade('a');
    const b = makeTrade('b');
    const result = diffTrades({
      prev: asPrev([a, b]),
      currentIds: idsOf([]),
      prevCount: 5,
      currentCount: 6, // only one accepted credit available
    });
    expect(result).toHaveLength(2);
    // Greedy: first iteration wins the budget, second falls through to declined.
    expect(result.map((r) => r.outcome)).toEqual(['accepted', 'declined']);
  });

  it('marks all resolved as accepted when delta matches resolved count', () => {
    const a = makeTrade('a');
    const b = makeTrade('b');
    const result = diffTrades({
      prev: asPrev([a, b]),
      currentIds: idsOf([]),
      prevCount: 5,
      currentCount: 7,
    });
    expect(result.map((r) => r.outcome)).toEqual(['accepted', 'accepted']);
  });

  it('marks all resolved as declined when tradesCount goes down (defensive)', () => {
    const a = makeTrade('a');
    const result = diffTrades({
      prev: asPrev([a]),
      currentIds: idsOf([]),
      prevCount: 5,
      currentCount: 4,
    });
    expect(result[0]?.outcome).toBe('declined');
  });

  it('only reports trades whose ids are no longer in the current snapshot', () => {
    const a = makeTrade('a');
    const b = makeTrade('b');
    const result = diffTrades({
      prev: asPrev([a, b]),
      currentIds: idsOf([b]),
      prevCount: 0,
      currentCount: 1,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.trade.id).toBe('a');
  });
});
