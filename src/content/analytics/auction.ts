import type {
  AirportBlock,
  Block,
  CityBlock,
  CompanyBlock,
  GameState,
  Participant,
} from '@shared/types';
import { airportLandingRent, cityLandingRent } from './property';
import { companyLandingRent, countOwnedCompanies } from './companies';
import { landingProbability } from './dice';
import {
  simulateOwnership,
  sumSelfAirportRent,
  sumSetRent,
  type IndexedCity,
} from './trades';

export type AuctionSetBucket =
  | 'completes-monopoly'
  | 'one-away-after'
  | 'far'
  | 'singleton'
  | 'denial-only'
  | 'company';

export interface AuctionAdviceComponents {
  listPrice: number;
  expectedRentPerRoll: number;
  expectedRent: number;
  horizonRolls: number;
  setBucket: AuctionSetBucket;
  setUplift: number;
  denialBonus: number;
  liquidityCap: number;
  // Recoverable cash if you win the auction and immediately mortgage the tile
  // (price × MORTGAGE_RECOVERY). Acts as a floor on maxBid: a bid below this
  // amount is essentially free since the value can be reclaimed.
  mortgageFloor: number;
  threatCeiling: number;
  threatOpponentId: string | null;
  currentHighBid: number;
  currentHighBidderId: string | null;
  secondsRemaining: number;
}

export interface AuctionAdvice {
  blockIndex: number;
  block: Block;
  // false → the auctioned tile cannot be valued (corner / tax / bonus / a tile
  // self already owns). A no-op recommendation is returned with `notice` set.
  available: boolean;
  notice: string | null;
  maxBid: number;
  suggestedOpening: number;
  pass: boolean;
  components: AuctionAdviceComponents;
}

const BUCKET_MULTIPLIER: Record<AuctionSetBucket, number> = {
  'completes-monopoly': 1.6,
  'one-away-after': 1.2,
  'far': 1.0,
  'singleton': 1.0,
  'denial-only': 1.0,
  'company': 1.0,
};

const PHASE_EARLY = 0.6;
const PHASE_LATE = 1.2;
const HORIZON_EARLY = 8;
const HORIZON_MID = 14;
const HORIZON_LATE = 20;
const LIQUIDITY_EARLY = 0.5;
const LIQUIDITY_NORMAL = 0.4;
const THREAT_FRACTION = 0.4;
const DENIAL_FRACTION = 0.5;
const EXPECTED_DICE_SUM = 7;
// Standard Monopoly / richup convention — mortgaging recovers half the listed
// price. Mirrors `b.price / 2` in calcParticipantNetWorth (player.ts).
const MORTGAGE_RECOVERY = 0.5;
// pass triggers when even the mortgage floor isn't recoverable (liquidity
// caps the bid below the recoverable amount). 0.9 leaves a sliver of slack so
// near-misses don't flip into pass on rounding.
const MORTGAGE_FLOOR_PASS_THRESHOLD = 0.9;

export function evaluateAuction(
  state: GameState | null | undefined,
  selfId: string,
): AuctionAdvice | null {
  if (!state) return null;
  const auction = state.auction;
  if (!auction) return null;

  const blocks = state.blocks ?? [];
  const blockIndex = auction.blockIndex;
  const block = blocks[blockIndex];
  if (!block) return null;

  const participants = Array.isArray(state.participants) ? state.participants : [];
  const self = participants.find((p) => p.id === selfId);
  if (!self) return null;
  if (self.bankruptedAt !== null) return null;
  if (self.votekickedAt !== null) return null;
  if (self.connectivity === 'disconnected') return null;

  const opponents = participants.filter(
    (p) =>
      p.id !== selfId &&
      p.bankruptedAt === null &&
      p.votekickedAt === null,
  );

  const startingCash = state.settings?.startingCash ?? 0;
  const phaseRatio = computePhaseRatio(opponents, startingCash);
  const horizonRolls =
    phaseRatio < PHASE_EARLY
      ? HORIZON_EARLY
      : phaseRatio < PHASE_LATE
        ? HORIZON_MID
        : HORIZON_LATE;
  const liquidityFraction =
    phaseRatio < PHASE_EARLY ? LIQUIDITY_EARLY : LIQUIDITY_NORMAL;
  const liquidityCap = Math.max(0, Math.floor(self.money * liquidityFraction));

  const threat = computeThreatForTile(block, opponents, blocks);
  const { highBid, highBidderId } = highestBid(auction.bids);
  const secondsRemaining = computeSecondsRemaining(auction.endAt);
  const listPrice = (block as { price?: number }).price ?? 0;
  const mortgageFloor = Math.floor(listPrice * MORTGAGE_RECOVERY);

  const baseEmpty: AuctionAdviceComponents = {
    listPrice,
    expectedRentPerRoll: 0,
    expectedRent: 0,
    horizonRolls,
    setBucket: 'far',
    setUplift: 0,
    denialBonus: 0,
    liquidityCap,
    mortgageFloor,
    threatCeiling: threat.ceiling,
    threatOpponentId: threat.opponentId,
    currentHighBid: highBid,
    currentHighBidderId: highBidderId,
    secondsRemaining,
  };

  if (
    block.type !== 'city' &&
    block.type !== 'airport' &&
    block.type !== 'company'
  ) {
    return {
      blockIndex,
      block,
      available: false,
      notice: 'Tile is not a property',
      maxBid: 0,
      suggestedOpening: 0,
      pass: true,
      components: baseEmpty,
    };
  }

  if (block.ownerId === selfId) {
    return {
      blockIndex,
      block,
      available: false,
      notice: 'You already own this tile',
      maxBid: 0,
      suggestedOpening: 0,
      pass: true,
      components: baseEmpty,
    };
  }

  // Hypothetical: self wins the auction. The patch covers all property
  // types — simulateOwnership only rewrites cities, so airports/companies
  // need an explicit override.
  const blocksHyp = patchOwner(
    simulateOwnership(blocks, [blockIndex], selfId),
    blockIndex,
    selfId,
  );

  const expectedRentPerRoll = expectedRentPerRollForTile(
    block,
    blocksHyp,
    blockIndex,
    selfId,
    opponents,
    state,
  );
  const expectedRent = expectedRentPerRoll * horizonRolls;

  const setEval = evaluateSetContext({
    block,
    blockIndex,
    blocks,
    blocksHyp,
    selfId,
    opponents,
    state,
  });

  const multiplier = BUCKET_MULTIPLIER[setEval.bucket];
  const strategicValue =
    expectedRent * multiplier + setEval.setUplift + setEval.denialBonus;

  // The mortgage floor is recoverable cash, so any bid up to that level has
  // ≈ zero net cost. Floor maxBid against it; the liquidity cap still limits
  // the absolute ceiling so we don't recommend bidding into bankruptcy.
  const valuedBid = Math.max(strategicValue, mortgageFloor);
  const maxBid = Math.max(0, Math.floor(Math.min(valuedBid, liquidityCap)));
  const suggestedOpening = Math.max(
    0,
    Math.floor(
      Math.min(threat.ceiling * 0.6, maxBid * 0.5, listPrice * 0.5),
    ),
  );
  // Only recommend pass when even the mortgage floor isn't reachable — i.e.
  // liquidity is so tight you can't even break even on a forced mortgage.
  const pass =
    listPrice > 0 ? maxBid < mortgageFloor * MORTGAGE_FLOOR_PASS_THRESHOLD : maxBid <= 0;

  return {
    blockIndex,
    block,
    available: true,
    notice: setEval.notice,
    maxBid,
    suggestedOpening,
    pass,
    components: {
      listPrice,
      expectedRentPerRoll,
      expectedRent,
      horizonRolls,
      setBucket: setEval.bucket,
      setUplift: setEval.setUplift,
      denialBonus: setEval.denialBonus,
      liquidityCap,
      mortgageFloor,
      threatCeiling: threat.ceiling,
      threatOpponentId: threat.opponentId,
      currentHighBid: highBid,
      currentHighBidderId: highBidderId,
      secondsRemaining,
    },
  };
}

// Returns `blocks` with the given index rewritten to `ownerId`, unmortgaged,
// for any property type. simulateOwnership only handles cities; we layer
// airport/company support on top so the same hypothetical can be reused for
// rent calculations regardless of property type.
function patchOwner(
  blocks: Block[],
  index: number,
  ownerId: string,
): Block[] {
  const b = blocks[index];
  if (!b) return blocks;
  if (b.type === 'airport' || b.type === 'company') {
    return blocks.map((blk, i) =>
      i === index && (blk?.type === 'airport' || blk?.type === 'company')
        ? { ...blk, ownerId, isMortgaged: false }
        : blk,
    );
  }
  return blocks;
}

function computePhaseRatio(
  opponents: Participant[],
  startingCash: number,
): number {
  if (startingCash <= 0 || opponents.length === 0) return 1;
  const sum = opponents.reduce((s, o) => s + o.money, 0);
  return sum / opponents.length / startingCash;
}

// Threat ceiling weighted by each opponent's *interest* in the tile being
// auctioned. A wealthy opponent who has no use for the tile is a smaller
// threat than a poorer one who'd complete a monopoly with it. The interest
// multiplier is grounded in marginal-rent intuition (a 4th airport doubles
// the rent ladder; a 2nd utility unlocks 10× rent; a city that completes a
// set is far more valuable than the same city standing alone).
function computeThreatForTile(
  block: Block,
  opponents: Participant[],
  blocks: Block[],
): { ceiling: number; opponentId: string | null } {
  let ceiling = 0;
  let opponentId: string | null = null;
  for (const o of opponents) {
    const interest = opponentInterest(o, block, blocks);
    const cap = Math.floor(o.money * THREAT_FRACTION * interest);
    if (cap > ceiling) {
      ceiling = cap;
      opponentId = o.id;
    }
  }
  return { ceiling, opponentId };
}

function opponentInterest(
  o: Participant,
  block: Block,
  blocks: Block[],
): number {
  if (block.type === 'city') {
    const setCities = collectCityGroup(blocks, block.countryId);
    const setSize = setCities.length;
    if (setSize < 2) return 1.0;
    const ownedInSet = setCities.filter((c) => c.block.ownerId === o.id).length;
    if (ownedInSet + 1 === setSize) return 2.5;          // they'd complete the monopoly
    if (ownedInSet + 1 === setSize - 1 && setSize >= 3) return 1.5; // one-away after
    if (ownedInSet > 0) return 1.3;                       // foothold in the set
    return 1.0;                                           // baseline
  }
  if (block.type === 'airport') {
    const owned = countOwnedAirports(blocks, o.id);
    // Each additional airport roughly doubles the rent the owner collects on
    // their existing airports, so a 4th airport for a 3-airport opponent is
    // proportionally far more valuable than a 1st for a 0-airport opponent.
    const ladder = [1.0, 1.3, 1.7, 2.2];
    return ladder[owned] ?? 1.0;
  }
  if (block.type === 'company') {
    const owned = countOwnedCompanies(blocks, o.id);
    return owned === 1 ? 2.0 : 1.0;                       // 2nd utility unlocks 10× rent
  }
  return 1.0;
}

// Tolerant of shapes we haven't pinned down: richup's `auction.bids` could be a
// Record<id, amount>, an array of {by/playerId, amount} entries, or absent
// entirely on a freshly-started auction. Anything we don't recognize collapses
// to "no bids" rather than throwing — a wrong "No bids yet" line is far better
// than the whole advisor crashing.
function highestBid(bids: unknown): {
  highBid: number;
  highBidderId: string | null;
} {
  let highBid = 0;
  let highBidderId: string | null = null;
  if (!bids || typeof bids !== 'object') return { highBid, highBidderId };

  if (Array.isArray(bids)) {
    for (const entry of bids) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const amount = typeof e.amount === 'number' ? e.amount : null;
      if (amount === null) continue;
      const id =
        typeof e.participantId === 'string'
          ? e.participantId
          : typeof e.playerId === 'string'
            ? e.playerId
            : typeof e.by === 'string'
              ? e.by
              : null;
      if (amount > highBid) {
        highBid = amount;
        highBidderId = id;
      }
    }
    return { highBid, highBidderId };
  }

  for (const [id, amount] of Object.entries(bids as Record<string, unknown>)) {
    if (typeof amount !== 'number') continue;
    if (amount > highBid) {
      highBid = amount;
      highBidderId = id;
    }
  }
  return { highBid, highBidderId };
}

function computeSecondsRemaining(endAt: string | undefined | null): number {
  if (!endAt) return 0;
  const t = Date.parse(endAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((t - Date.now()) / 1000));
}

function expectedRentPerRollForTile(
  origBlock: CityBlock | AirportBlock | CompanyBlock,
  blocksHyp: Block[],
  blockIndex: number,
  selfId: string,
  opponents: Participant[],
  state: GameState,
): number {
  const hyp = blocksHyp[blockIndex];
  if (
    !hyp ||
    (hyp.type !== 'city' && hyp.type !== 'airport' && hyp.type !== 'company')
  ) {
    return 0;
  }
  let total = 0;
  for (const o of opponents) {
    const prob = landingProbability(
      blocksHyp,
      state.boardConfig,
      o.position,
      blockIndex,
    );
    if (prob === 0) continue;

    let rent: number | null = null;
    if (hyp.type === 'city') {
      rent = cityLandingRent(hyp, o.id, blocksHyp, state.settings);
    } else if (hyp.type === 'airport') {
      rent = airportLandingRent(hyp, o.id, blocksHyp);
    } else {
      rent = companyLandingRent(hyp, o.id, blocksHyp, EXPECTED_DICE_SUM);
    }
    if (rent === null) continue;
    total += prob * rent;
  }
  void origBlock;
  return total;
}

interface SetEvalResult {
  bucket: AuctionSetBucket;
  setUplift: number;
  denialBonus: number;
  notice: string | null;
}

function evaluateSetContext(input: {
  block: CityBlock | AirportBlock | CompanyBlock;
  blockIndex: number;
  blocks: Block[];
  blocksHyp: Block[];
  selfId: string;
  opponents: Participant[];
  state: GameState;
}): SetEvalResult {
  const { block, blockIndex, blocks, blocksHyp, selfId, opponents, state } = input;

  if (block.type === 'company') {
    const ownedAfter = countOwnedCompanies(blocks, selfId) + 1;
    const total = countTotalCompanies(blocks);
    let notice: string | null;
    if (total > 1 && ownedAfter === total) {
      notice = `Locks in 10× utility rent (${ownedAfter}/${total})`;
    } else {
      notice = `Companies pay dice-roll rent (${ownedAfter}/${total})`;
    }
    return {
      bucket: 'company',
      setUplift: 0,
      denialBonus: 0,
      notice,
    };
  }

  if (block.type === 'airport') {
    const sampler = sampleLanderId(opponents, selfId);
    const before = sumSelfAirportRent(blocks, selfId, sampler);
    const after = sumSelfAirportRent(blocksHyp, selfId, sampler);
    const setUplift = Math.max(0, after - before);
    const ownedAfter = countOwnedAirports(blocksHyp, selfId);
    const totalAirports = countTotalAirports(blocks);
    let bucket: AuctionSetBucket = 'far';
    if (ownedAfter === totalAirports) bucket = 'completes-monopoly';
    else if (ownedAfter >= totalAirports - 1) bucket = 'one-away-after';
    else if (ownedAfter === 1) bucket = 'singleton';
    return {
      bucket,
      setUplift,
      denialBonus: 0,
      notice: `Airports owned: ${ownedAfter}/${totalAirports}`,
    };
  }

  // City branch.
  const setCities = collectCityGroup(blocks, block.countryId);
  const setSize = setCities.length;
  const selfOwnedNow = setCities.filter(
    (c) => c.block.ownerId === selfId,
  ).length;
  // The auctioned tile is bank-owned during the auction (still null).
  const selfOwnedAfter = selfOwnedNow + 1;

  let bucket: AuctionSetBucket;
  let setUplift = 0;
  if (setSize >= 2 && selfOwnedAfter === setSize) {
    bucket = 'completes-monopoly';
    const sampler = sampleLanderId(opponents, selfId);
    const { rentBefore, rentAfter } = sumSetRent(
      setCities,
      blocksHyp,
      blocks,
      selfId,
      sampler,
      state.settings,
    );
    setUplift = Math.max(0, rentAfter - rentBefore);
  } else if (setSize >= 2 && selfOwnedAfter === setSize - 1) {
    // For a 2-city set this means owning 1/2 — semantically one trade away
    // from the monopoly, so it should get the same uplift treatment as the
    // 3+ case rather than buckiting as a true singleton.
    bucket = 'one-away-after';
  } else if (selfOwnedAfter === 1 && setSize >= 2) {
    bucket = 'singleton';
  } else {
    bucket = 'far';
  }

  const denial = computeDenialBonus({
    setCities,
    setSize,
    blocks,
    selfId,
    opponents,
    state,
  });

  if (selfOwnedNow === 0 && denial.bonus > 0) {
    bucket = 'denial-only';
  }

  let notice: string | null;
  if (bucket === 'completes-monopoly') {
    notice = `Completes the set (${selfOwnedAfter}/${setSize})`;
  } else if (bucket === 'one-away-after') {
    notice = `One away after (${selfOwnedAfter}/${setSize})`;
  } else if (bucket === 'singleton') {
    notice = `Singleton (${selfOwnedAfter}/${setSize})`;
  } else if (bucket === 'denial-only') {
    notice = `Denies ${denial.opponentName ?? 'opponent'} (${denial.opponentOwnedNow}/${setSize})`;
  } else {
    notice = `Far from set (${selfOwnedAfter}/${setSize})`;
  }
  if (
    denial.bonus > 0 &&
    bucket !== 'denial-only' &&
    denial.opponentName
  ) {
    notice += ` · also denies ${denial.opponentName}`;
  }

  void blockIndex;
  return {
    bucket,
    setUplift,
    denialBonus: denial.bonus,
    notice,
  };
}

interface DenialResult {
  bonus: number;
  opponentName: string | null;
  opponentOwnedNow: number;
}

function computeDenialBonus(input: {
  setCities: IndexedCity[];
  setSize: number;
  blocks: Block[];
  selfId: string;
  opponents: Participant[];
  state: GameState;
}): DenialResult {
  const { setCities, setSize, blocks, selfId, opponents, state } = input;
  if (setSize < 2) return { bonus: 0, opponentName: null, opponentOwnedNow: 0 };
  for (const opp of opponents) {
    const opponentOwned = setCities.filter(
      (c) => c.block.ownerId === opp.id,
    ).length;
    if (opponentOwned !== setSize - 1) continue;
    // Their missing piece must be the auctioned (still bank-owned) tile.
    const missing = setCities.find((c) => c.block.ownerId !== opp.id);
    if (!missing || missing.block.ownerId !== null) continue;

    // What rent uplift does the opponent gain if they win the auction?
    // Sample landing player must not be the would-be owner.
    const sampler = opponents.find((o) => o.id !== opp.id)?.id ?? selfId;
    const hyp = simulateOwnership(blocks, [missing.index], opp.id);
    const { rentBefore, rentAfter } = sumSetRent(
      setCities,
      hyp,
      blocks,
      opp.id,
      sampler,
      state.settings,
    );
    const opponentUplift = Math.max(0, rentAfter - rentBefore);
    return {
      bonus: opponentUplift * DENIAL_FRACTION,
      opponentName: opp.name,
      opponentOwnedNow: opponentOwned,
    };
  }
  return { bonus: 0, opponentName: null, opponentOwnedNow: 0 };
}

function collectCityGroup(blocks: Block[], countryId: string): IndexedCity[] {
  const out: IndexedCity[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b?.type === 'city' && b.countryId === countryId) {
      out.push({ block: b, index: i });
    }
  }
  return out;
}

function sampleLanderId(opponents: Participant[], selfId: string): string {
  return opponents[0]?.id ?? selfId;
}

function countOwnedAirports(blocks: Block[], selfId: string): number {
  let n = 0;
  for (const b of blocks) {
    if (b?.type === 'airport' && b.ownerId === selfId) n++;
  }
  return n;
}

function countTotalAirports(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) if (b?.type === 'airport') n++;
  return n;
}

function countTotalCompanies(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) if (b?.type === 'company') n++;
  return n;
}
