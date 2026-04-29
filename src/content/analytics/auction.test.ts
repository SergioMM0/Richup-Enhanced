import { describe, expect, it } from 'vitest';
import { evaluateAuction } from './auction';
import { landingProbability, predictLanding } from './dice';
import type {
  AirportBlock,
  Auction,
  BlockType,
  BoardConfig,
  CityBlock,
  CompanyBlock,
  GameSettings,
  GameState,
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

const boardConfig: BoardConfig = {
  goReward: { land: 300, pass: 200 },
  prisonBlockIndex: 10,
  goToPrisonBlockIndex: 30,
  vacationBlockIndex: 20,
};

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
  name: 'Airport',
  price: 200,
  ownerId: null,
  isMortgaged: false,
  rentPrices: [25, 50, 100, 200],
  ...overrides,
});

const company = (overrides: Partial<CompanyBlock> = {}): CompanyBlock => ({
  type: 'company',
  name: 'Utility',
  price: 150,
  ownerId: null,
  isMortgaged: false,
  ...overrides,
});

// 40-tile board with corner placeholders at 0/10/20/30. Properties go at the
// indexes provided; remaining slots become bonus placeholders so they're
// "movable through" without being treated as Go-to-Prison redirects.
function makeBoard(props: Record<number, CityBlock | AirportBlock | CompanyBlock>): GameState['blocks'] {
  const out: GameState['blocks'] = [];
  for (let i = 0; i < 40; i++) {
    if (props[i]) {
      out.push(props[i]!);
      continue;
    }
    if (i === 0) out.push({ type: 'corner', name: 'Go', cornerType: 'go' });
    else if (i === 10) out.push({ type: 'corner', name: 'Prison', cornerType: 'prison' });
    else if (i === 20) out.push({ type: 'corner', name: 'Vacation', cornerType: 'vacation' });
    else if (i === 30) out.push({ type: 'corner', name: 'Go to prison', cornerType: 'go_to_prison' });
    else out.push({ type: 'tax', name: 'Filler' });
  }
  return out;
}

const baseStats = {
  turnsCount: 5,
  startedAt: '2026-04-29T00:00:00Z',
  endedAt: null,
  doublesCount: 0,
  chatMessagesCount: 0,
  tradesCount: 0,
  leaderboard: {},
  heatMap: {},
  netWorths: {},
  prisonVisits: {},
  allParticipants: [],
};

function makeState(overrides: {
  blocks: GameState['blocks'];
  participants: Participant[];
  auction: Auction | null;
  participantSettings?: Partial<GameSettings>;
}): GameState {
  return {
    id: 'test-room',
    phase: 'playing',
    participants: overrides.participants,
    currentPlayerIndex: 0,
    mapId: 'classic',
    blocks: overrides.blocks,
    boardConfig,
    dice: [3, 4],
    cubesRolledInTurn: false,
    canPerformTurnActions: true,
    doublesInARow: 0,
    auction: overrides.auction,
    trades: [],
    bonusCards: [],
    vacationCash: 0,
    settings: { ...settings, ...overrides.participantSettings },
    hostId: overrides.participants[0]?.id ?? 'self',
    winnerId: null,
    stats: baseStats,
  };
}

const FAR_FUTURE = '2099-12-31T23:59:59Z';

describe('evaluateAuction — preconditions', () => {
  it('returns null when no auction is in progress', () => {
    const state = makeState({
      blocks: makeBoard({ 7: city() }),
      participants: [player({ id: 'self' }), player({ id: 'bob' })],
      auction: null,
    });
    expect(evaluateAuction(state, 'self')).toBeNull();
  });

  it('returns null when self is bankrupt', () => {
    const state = makeState({
      blocks: makeBoard({ 7: city() }),
      participants: [
        player({ id: 'self', bankruptedAt: '2026-04-29T00:00:00Z' }),
        player({ id: 'bob' }),
      ],
      auction: { blockIndex: 7, bids: {}, endAt: FAR_FUTURE },
    });
    expect(evaluateAuction(state, 'self')).toBeNull();
  });

  it('returns null when self is disconnected', () => {
    const state = makeState({
      blocks: makeBoard({ 7: city() }),
      participants: [
        player({ id: 'self', connectivity: 'disconnected' }),
        player({ id: 'bob' }),
      ],
      auction: { blockIndex: 7, bids: {}, endAt: FAR_FUTURE },
    });
    expect(evaluateAuction(state, 'self')).toBeNull();
  });

  it('flags non-property auctions as unavailable', () => {
    const state = makeState({
      blocks: makeBoard({}),
      participants: [player({ id: 'self' }), player({ id: 'bob' })],
      // index 0 is the Go corner placeholder.
      auction: { blockIndex: 0, bids: {}, endAt: FAR_FUTURE },
    });
    const advice = evaluateAuction(state, 'self');
    expect(advice).not.toBeNull();
    expect(advice!.available).toBe(false);
    expect(advice!.notice).toMatch(/not a property/i);
    expect(advice!.maxBid).toBe(0);
  });
});

describe('evaluateAuction — city singleton (3+ city set)', () => {
  it('produces a positive max bid bounded by liquidity', () => {
    // 3-city set, all bank-owned. Self winning the auction takes 1/3 ownership
    // — that's the "singleton" case (still 2 trades from monopoly).
    const state = makeState({
      blocks: makeBoard({
        7: city({ name: 'A', countryId: 'red', price: 200 }),
        17: city({ name: 'B', countryId: 'red', price: 200 }),
        27: city({ name: 'C', countryId: 'red', price: 200 }),
      }),
      participants: [
        player({ id: 'self', position: 0, money: 1500 }),
        player({ id: 'bob', position: 0, money: 1500 }),
      ],
      auction: { blockIndex: 7, bids: {}, endAt: FAR_FUTURE },
    });
    const advice = evaluateAuction(state, 'self')!;
    expect(advice.available).toBe(true);
    expect(advice.components.setBucket).toBe('singleton');
    expect(advice.maxBid).toBeGreaterThan(0);
    expect(advice.maxBid).toBeLessThanOrEqual(advice.components.liquidityCap);
    // 14-roll horizon (phaseRatio = 1500/1500 = 1.0, mid bracket).
    expect(advice.components.horizonRolls).toBe(14);
  });
});

describe('evaluateAuction — 2-city set one-away', () => {
  it('buckets 1/2 ownership as one-away-after (one trade from monopoly)', () => {
    // 2-city set (e.g. USA = NY + SF). Self winning takes 1/2 ownership which
    // is *one trade away* from a monopoly, not a true singleton.
    const state = makeState({
      blocks: makeBoard({
        7: city({ name: 'A', countryId: 'red', price: 200 }),
        17: city({ name: 'B', countryId: 'red', price: 200 }),
      }),
      participants: [
        player({ id: 'self', position: 0, money: 1500 }),
        player({ id: 'bob', position: 0, money: 1500 }),
      ],
      auction: { blockIndex: 7, bids: {}, endAt: FAR_FUTURE },
    });
    const advice = evaluateAuction(state, 'self')!;
    expect(advice.components.setBucket).toBe('one-away-after');
  });
});

describe('evaluateAuction — completes monopoly', () => {
  it('detects monopoly completion and adds setUplift', () => {
    const blocks = makeBoard({
      3: city({ name: 'A', countryId: 'red', ownerId: 'self' }),
      5: city({ name: 'B', countryId: 'red', ownerId: 'self' }),
      7: city({ name: 'C', countryId: 'red', ownerId: null }),
    });
    const state = makeState({
      blocks,
      participants: [
        player({ id: 'self', position: 0, money: 2000 }),
        player({ id: 'bob', position: 0, money: 2000 }),
      ],
      auction: { blockIndex: 7, bids: {}, endAt: FAR_FUTURE },
    });
    const advice = evaluateAuction(state, 'self')!;
    expect(advice.components.setBucket).toBe('completes-monopoly');
    expect(advice.components.setUplift).toBeGreaterThan(0);
    // Multiplier 1.6 + uplift should push a completes-monopoly bid above
    // a comparable singleton in the same conditions.
    const singletonState = makeState({
      blocks: makeBoard({
        7: city({ name: 'C', countryId: 'red' }),
        17: city({ name: 'D', countryId: 'red' }),
      }),
      participants: [
        player({ id: 'self', position: 0, money: 2000 }),
        player({ id: 'bob', position: 0, money: 2000 }),
      ],
      auction: { blockIndex: 7, bids: {}, endAt: FAR_FUTURE },
    });
    const singleton = evaluateAuction(singletonState, 'self')!;
    expect(advice.maxBid).toBeGreaterThan(singleton.maxBid);
  });
});

describe('evaluateAuction — denial', () => {
  it('flags denial-only when an opponent is one piece from the set', () => {
    const blocks = makeBoard({
      3: city({ name: 'A', countryId: 'red', ownerId: 'bob' }),
      5: city({ name: 'B', countryId: 'red', ownerId: 'bob' }),
      7: city({ name: 'C', countryId: 'red', ownerId: null }),
    });
    const state = makeState({
      blocks,
      participants: [
        player({ id: 'self', position: 0, money: 2000 }),
        player({ id: 'bob', position: 0, money: 2000, name: 'Bob' }),
      ],
      auction: { blockIndex: 7, bids: {}, endAt: FAR_FUTURE },
    });
    const advice = evaluateAuction(state, 'self')!;
    expect(advice.components.setBucket).toBe('denial-only');
    expect(advice.components.denialBonus).toBeGreaterThan(0);
    expect(advice.notice).toMatch(/[Dd]enies/);
  });
});

describe('evaluateAuction — liquidity cap', () => {
  it('caps maxBid at 50% of self money in early game (low avg cash)', () => {
    const blocks = makeBoard({ 7: city() });
    const state = makeState({
      blocks,
      participants: [
        player({ id: 'self', position: 0, money: 100 }),
        // phaseRatio = 100/1500 ≈ 0.067 < 0.6 → liquidityFraction = 0.5.
        player({ id: 'bob', position: 0, money: 100 }),
      ],
      auction: { blockIndex: 7, bids: {}, endAt: FAR_FUTURE },
    });
    const advice = evaluateAuction(state, 'self')!;
    expect(advice.components.liquidityCap).toBe(50);
    expect(advice.maxBid).toBeLessThanOrEqual(50);
  });

  it('caps maxBid at 40% of self money in mid/late game', () => {
    const blocks = makeBoard({ 7: city() });
    const state = makeState({
      blocks,
      participants: [
        player({ id: 'self', position: 0, money: 1000 }),
        player({ id: 'bob', position: 0, money: 2000 }),
      ],
      auction: { blockIndex: 7, bids: {}, endAt: FAR_FUTURE },
    });
    const advice = evaluateAuction(state, 'self')!;
    // Avg opponent cash is bob's 2000; phaseRatio = 2000/1500 ≈ 1.33 → late
    // bracket → liquidityFraction = 0.4 → cap = 400.
    expect(advice.components.liquidityCap).toBe(400);
  });
});

describe('evaluateAuction — airport', () => {
  it('flags one-away-after when self already owns 2/3', () => {
    // Three airports total. Self owns 2 → buying makes 3/3.
    const blocks = makeBoard({
      5: airport({ name: 'A1', ownerId: 'self' }),
      15: airport({ name: 'A2', ownerId: 'self' }),
      7: airport({ name: 'A3', ownerId: null }),
    });
    const state = makeState({
      blocks,
      participants: [
        player({ id: 'self', position: 0, money: 2000 }),
        player({ id: 'bob', position: 0, money: 2000 }),
      ],
      auction: { blockIndex: 7, bids: {}, endAt: FAR_FUTURE },
    });
    const advice = evaluateAuction(state, 'self')!;
    expect(advice.components.setBucket).toBe('completes-monopoly');
    // Going 2 → 3 airports moves the rent ladder from 50 to 100 per landing
    // on each of self's airports, giving a positive uplift.
    expect(advice.components.setUplift).toBeGreaterThan(0);
  });
});

describe('evaluateAuction — companies', () => {
  it('uses 10× multiplier when owning the second company completes both', () => {
    const blocks = makeBoard({
      5: company({ name: 'Water', ownerId: 'self' }),
      7: company({ name: 'Electric', ownerId: null }),
    });
    const state = makeState({
      blocks,
      participants: [
        player({ id: 'self', position: 0, money: 2000 }),
        player({ id: 'bob', position: 0, money: 2000 }),
      ],
      auction: { blockIndex: 7, bids: {}, endAt: FAR_FUTURE },
    });
    const advice = evaluateAuction(state, 'self')!;
    expect(advice.components.setBucket).toBe('company');
    // bob lands on tile 7 with sum 7 (prob 6/36); 7 × 10 = 70 expected rent.
    // expectedRentPerRoll ≈ 6/36 × 70 ≈ 11.67.
    expect(advice.components.expectedRentPerRoll).toBeCloseTo((6 / 36) * 70, 5);
    expect(advice.notice).toMatch(/10×/);
  });

  it('uses 4× multiplier when self has no other company yet', () => {
    const blocks = makeBoard({
      7: company({ name: 'Water', ownerId: null }),
      12: company({ name: 'Electric', ownerId: 'bob' }),
    });
    const state = makeState({
      blocks,
      participants: [
        player({ id: 'self', position: 0, money: 2000 }),
        player({ id: 'bob', position: 0, money: 2000 }),
      ],
      auction: { blockIndex: 7, bids: {}, endAt: FAR_FUTURE },
    });
    const advice = evaluateAuction(state, 'self')!;
    expect(advice.components.setBucket).toBe('company');
    // bob → tile 7 with sum 7 (prob 6/36); 7 × 4 = 28.
    expect(advice.components.expectedRentPerRoll).toBeCloseTo((6 / 36) * 28, 5);
  });
});

describe('evaluateAuction — pass recommendation', () => {
  it('marks pass=true when liquidity cap forces maxBid below half list price', () => {
    const blocks = makeBoard({ 7: city({ price: 400 }) });
    const state = makeState({
      blocks,
      participants: [
        player({ id: 'self', position: 0, money: 100 }),
        player({ id: 'bob', position: 0, money: 100 }),
      ],
      auction: { blockIndex: 7, bids: {}, endAt: FAR_FUTURE },
    });
    const advice = evaluateAuction(state, 'self')!;
    // liquidityCap = 50, listPrice = 400, half = 200 → pass.
    expect(advice.components.liquidityCap).toBe(50);
    expect(advice.pass).toBe(true);
  });
});

describe('evaluateAuction — mortgage floor', () => {
  it('lifts maxBid to ≈ price/2 even when expected rent is zero', () => {
    // Far from any opponent: 3-city set, all bank-owned, opponent stuck at the
    // far side of the board with no chance of landing on the auctioned tile.
    // Expected rent ≈ 0 → strategic value ≈ 0. Without the floor, the advisor
    // would recommend $0 / pass, but mortgaging the won tile is recoverable
    // cash so we should still bid up to roughly price/2.
    const state = makeState({
      blocks: makeBoard({
        7: city({ name: 'A', countryId: 'red', price: 350 }),
        17: city({ name: 'B', countryId: 'red', price: 350 }),
        27: city({ name: 'C', countryId: 'red', price: 350 }),
      }),
      participants: [
        // Both at position 0 — opponent rolling 7 lands on tile 7, so there
        // is some expected rent. Move opponent to the bonus-tile zone past
        // the auctioned tile to neutralize the per-roll probability.
        player({ id: 'self', position: 0, money: 1500 }),
        player({ id: 'bob', position: 25, money: 1500 }),
      ],
      auction: { blockIndex: 7, bids: {}, endAt: FAR_FUTURE },
    });
    const advice = evaluateAuction(state, 'self')!;
    expect(advice.components.mortgageFloor).toBe(175);
    // maxBid is at least the mortgage floor (rounded down), capped by liquidity.
    expect(advice.maxBid).toBeGreaterThanOrEqual(175);
    expect(advice.pass).toBe(false);
  });

  it('still recommends pass when even the mortgage floor is unaffordable', () => {
    // High list price, very low cash → liquidityCap < mortgageFloor.
    const blocks = makeBoard({ 7: city({ price: 400 }) });
    const state = makeState({
      blocks,
      participants: [
        player({ id: 'self', position: 0, money: 100 }),
        player({ id: 'bob', position: 0, money: 100 }),
      ],
      auction: { blockIndex: 7, bids: {}, endAt: FAR_FUTURE },
    });
    const advice = evaluateAuction(state, 'self')!;
    expect(advice.components.mortgageFloor).toBe(200);
    expect(advice.components.liquidityCap).toBe(50);
    // 50 < 200 * 0.9 → pass.
    expect(advice.pass).toBe(true);
  });
});

describe('evaluateAuction — per-tile threat weighting', () => {
  it('boosts the airport threat ceiling for a 3-airport opponent on the 4th', () => {
    const blocks = makeBoard({
      5: airport({ name: 'A1', ownerId: 'bob' }),
      15: airport({ name: 'A2', ownerId: 'bob' }),
      25: airport({ name: 'A3', ownerId: 'bob' }),
      35: airport({ name: 'A4', ownerId: null }),
    });
    const state = makeState({
      blocks,
      participants: [
        player({ id: 'self', position: 0, money: 1500 }),
        player({ id: 'bob', position: 0, money: 1000 }),
      ],
      auction: { blockIndex: 35, bids: {}, endAt: FAR_FUTURE },
    });
    const advice = evaluateAuction(state, 'self')!;
    // bob would complete his airport monopoly → ladder slot 3 (interest=2.2).
    // ceiling = floor(1000 * 0.4 * 2.2) = 880, vs flat 400 in the old logic.
    expect(advice.components.threatCeiling).toBe(880);
    expect(advice.components.threatOpponentId).toBe('bob');
  });

  it('boosts the city threat ceiling when an opponent would complete a 3-city monopoly', () => {
    const blocks = makeBoard({
      3: city({ name: 'A', countryId: 'red', ownerId: 'bob' }),
      5: city({ name: 'B', countryId: 'red', ownerId: 'bob' }),
      7: city({ name: 'C', countryId: 'red', ownerId: null }),
    });
    const state = makeState({
      blocks,
      participants: [
        player({ id: 'self', position: 0, money: 1500 }),
        player({ id: 'bob', position: 0, money: 1000 }),
      ],
      auction: { blockIndex: 7, bids: {}, endAt: FAR_FUTURE },
    });
    const advice = evaluateAuction(state, 'self')!;
    // bob owns 2/3 of the set → ownedInSet+1 === setSize → 2.5x.
    // ceiling = floor(1000 * 0.4 * 2.5) = 1000.
    expect(advice.components.threatCeiling).toBe(1000);
    expect(advice.components.threatOpponentId).toBe('bob');
  });

  it('keeps the flat 0.4 fraction when an opponent has no foothold in the set', () => {
    // 3-city set, opponent owns nothing in it → interest multiplier 1.0.
    const blocks = makeBoard({
      7: city({ name: 'A', countryId: 'red' }),
      17: city({ name: 'B', countryId: 'red' }),
      27: city({ name: 'C', countryId: 'red' }),
    });
    const state = makeState({
      blocks,
      participants: [
        player({ id: 'self', position: 0, money: 1500 }),
        player({ id: 'bob', position: 0, money: 1000 }),
      ],
      auction: { blockIndex: 7, bids: {}, endAt: FAR_FUTURE },
    });
    const advice = evaluateAuction(state, 'self')!;
    // Flat: 1000 * 0.4 = 400.
    expect(advice.components.threatCeiling).toBe(400);
  });
});

describe('evaluateAuction — auction state surfaces', () => {
  it('reports current high bid + bidder + threat ceiling', () => {
    const blocks = makeBoard({ 7: city() });
    const state = makeState({
      blocks,
      participants: [
        player({ id: 'self', money: 1500 }),
        player({ id: 'bob', money: 800, name: 'Bob' }),
        player({ id: 'carol', money: 1200, name: 'Carol' }),
      ],
      auction: {
        blockIndex: 7,
        bids: { bob: 50, carol: 80 },
        endAt: FAR_FUTURE,
      },
    });
    const advice = evaluateAuction(state, 'self')!;
    expect(advice.components.currentHighBid).toBe(80);
    expect(advice.components.currentHighBidderId).toBe('carol');
    // Threat = max(opp.money * 0.4) = 1200 * 0.4 = 480 → carol.
    expect(advice.components.threatCeiling).toBe(480);
    expect(advice.components.threatOpponentId).toBe('carol');
  });
});

describe('landingProbability', () => {
  const blocks = makeBoard({});

  it('returns 0 for unreachable tiles', () => {
    // From position 0, the smallest sum is 2 and largest is 12 — tile 1 is
    // unreachable.
    expect(landingProbability(blocks, boardConfig, 0, 1)).toBe(0);
    expect(landingProbability(blocks, boardConfig, 0, 13)).toBe(0);
  });

  it('matches the dice PMF for the hit sum', () => {
    // Sum 7 has probability 6/36; tile 7 from position 0.
    expect(landingProbability(blocks, boardConfig, 0, 7)).toBeCloseTo(6 / 36, 10);
    // Sum 2 has probability 1/36; tile 2 from position 0.
    expect(landingProbability(blocks, boardConfig, 0, 2)).toBeCloseTo(1 / 36, 10);
  });

  it('redirects Go-to-Prison sum onto the prison tile', () => {
    // From position 27, sum 3 lands on index 30 (Go-to-Prison) → redirected
    // to prison index 10.
    const fromPos = 27;
    const goToPrisonHit = landingProbability(blocks, boardConfig, fromPos, 30);
    const prisonHit = landingProbability(blocks, boardConfig, fromPos, 10);
    expect(goToPrisonHit).toBe(0);
    expect(prisonHit).toBeGreaterThan(0);
  });

  it("never sums above 1 across all reachable tiles from any position", () => {
    for (const fromPos of [0, 5, 17, 27, 35]) {
      let sum = 0;
      for (let target = 0; target < 40; target++) {
        sum += landingProbability(blocks, boardConfig, fromPos, target);
      }
      // Non-strict <= 1 — bonus tiles consume probability mass without
      // attributing it to any tile, so totals can be < 1.
      expect(sum).toBeGreaterThan(0);
      expect(sum).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('predictLanding', () => {
  it('flags bonus tiles as uncertain', () => {
    const blocks = makeBoard({});
    // Replace tile 7 with a bonus block.
    blocks[7] = { type: 'bonus', name: 'Treasure', bonusType: 'treasure' };
    const pred = predictLanding(blocks, boardConfig, 0, 7);
    expect(pred.uncertain).toBe(true);
    expect(pred.tileIndex).toBe(7);
  });

  it('redirects go_to_prison to prisonBlockIndex', () => {
    const blocks = makeBoard({});
    const pred = predictLanding(blocks, boardConfig, 27, 3);
    expect(pred.redirected).toBe(true);
    expect(pred.tileIndex).toBe(10);
  });

  it('returns the raw destination for ordinary tiles', () => {
    const blocks = makeBoard({});
    const pred = predictLanding(blocks, boardConfig, 0, 7);
    expect(pred.tileIndex).toBe(7);
    expect(pred.redirected).toBe(false);
    expect(pred.uncertain).toBe(false);
  });
});

// Sanity: the BlockType type is exhaustive; if richup adds a new block
// kind, the auction module should still compile (we cover city/airport/
// company explicitly and fall through everything else).
const _exhaust: BlockType[] = ['city', 'airport', 'company', 'corner', 'bonus', 'tax'];
void _exhaust;
