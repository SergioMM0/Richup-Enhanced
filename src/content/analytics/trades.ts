import type {
  AirportBlock,
  Block,
  CityBlock,
  GameSettings,
  Participant,
} from '@shared/types';
import { airportLandingRent, cityLandingRent } from './property';

export type TradeKind =
  | 'mutual-swap'
  | 'one-away'
  | 'airport'
  | 'two-away'
  | 'singleton-offer';

interface TradeOpportunityBase {
  kind: TradeKind;
  partnerId: string;
  // Block indexes self would receive in the trade.
  wantedBlockIndexes: number[];
  // Block indexes self would give up in the trade.
  offerBlockIndexes: number[];
  // Suggested cash component, paid by self for inbound trades and asked of
  // partner for singleton-offer.
  suggestedCash: number;
  // Sort key. For self-perspective opportunities this is self's per-landing
  // rent uplift in $; for singleton-offer it is the partner's uplift (= what
  // self can credibly ask for).
  valueScore: number;
  // Sum of landing rent on the affected tiles before vs after the trade,
  // computed from the perspective of whichever side gains the monopoly.
  rentBefore: number;
  rentAfter: number;
}

export interface OneAwayCityOpp extends TradeOpportunityBase {
  kind: 'one-away';
  setSize: number;
}

export interface MutualSwapOpp extends TradeOpportunityBase {
  kind: 'mutual-swap';
  setSize: number;
  partnerSetSize: number;
}

export interface TwoAwayCityOpp extends TradeOpportunityBase {
  kind: 'two-away';
  setSize: number;
}

export interface SingletonOfferOpp extends TradeOpportunityBase {
  kind: 'singleton-offer';
  partnerSetSize: number;
}

export interface AirportOpp extends TradeOpportunityBase {
  kind: 'airport';
  selfAirportCountAfter: number;
  totalAirports: number;
}

export type TradeOpportunity =
  | OneAwayCityOpp
  | MutualSwapOpp
  | TwoAwayCityOpp
  | SingletonOfferOpp
  | AirportOpp;

export interface FindTradesInput {
  selfId: string;
  participants: Participant[];
  blocks: Block[];
  settings: GameSettings;
  selfMoney: number;
}

const MAX_OPPORTUNITIES = 12;
const OFFER_HORIZON = 4;
const KIND_PRIORITY: Record<TradeKind, number> = {
  'mutual-swap': 0,
  'one-away': 1,
  'airport': 2,
  'two-away': 3,
  'singleton-offer': 4,
};

interface IndexedCity {
  block: CityBlock;
  index: number;
}

interface SelfOneAway {
  countryId: string;
  setSize: number;
  missingBlockIndex: number;
  missingBlock: CityBlock;
  partnerId: string;
  rentBefore: number;
  rentAfter: number;
  valueScore: number;
}

interface PartnerOneAway {
  partnerId: string;
  countryId: string;
  setSize: number;
  missingBlockIndex: number;
  missingBlock: CityBlock;
  rentBefore: number;
  rentAfter: number;
  valueScoreToPartner: number;
}

export function findTradeOpportunities(
  input: FindTradesInput,
): TradeOpportunity[] {
  const { selfId, participants, blocks, settings, selfMoney } = input;

  const self = participants.find((p) => p.id === selfId);
  if (!self || self.bankruptedAt) return [];

  const opponents = participants.filter(
    (p) => p.id !== selfId && p.bankruptedAt === null,
  );
  if (opponents.length === 0) return [];

  const citiesByCountry = groupCitiesByCountry(blocks);
  // Rent is independent of which non-owner lands, so a single sample suffices.
  const opponentSampleId = opponents[0]!.id;

  const selfOneAways = findSelfOneAways({
    selfId,
    opponents,
    blocks,
    settings,
    citiesByCountry,
    opponentSampleId,
  });
  const partnerOneAways = findPartnerOneAways({
    selfId,
    opponents,
    blocks,
    settings,
    citiesByCountry,
  });

  const opps: TradeOpportunity[] = [];
  const consumedSelfCountries = new Set<string>();
  const mutualOfferedBlocks = new Set<number>();

  for (const sa of selfOneAways) {
    const match = partnerOneAways.find(
      (pa) =>
        pa.partnerId === sa.partnerId &&
        pa.missingBlock.ownerId === selfId &&
        // Don't pair a set with itself when sa and pa describe the same group
        // (impossible by ownership, but guard anyway).
        pa.countryId !== sa.countryId,
    );
    if (!match) continue;
    consumedSelfCountries.add(sa.countryId);
    mutualOfferedBlocks.add(match.missingBlockIndex);
    opps.push({
      kind: 'mutual-swap',
      partnerId: sa.partnerId,
      wantedBlockIndexes: [sa.missingBlockIndex],
      offerBlockIndexes: [match.missingBlockIndex],
      suggestedCash: 0,
      valueScore: sa.valueScore,
      rentBefore: sa.rentBefore,
      rentAfter: sa.rentAfter,
      setSize: sa.setSize,
      partnerSetSize: match.setSize,
    });
  }

  for (const sa of selfOneAways) {
    if (consumedSelfCountries.has(sa.countryId)) continue;
    opps.push({
      kind: 'one-away',
      partnerId: sa.partnerId,
      wantedBlockIndexes: [sa.missingBlockIndex],
      offerBlockIndexes: [],
      suggestedCash: suggestCash(
        sa.valueScore,
        sa.missingBlock.price,
        selfMoney,
      ),
      valueScore: sa.valueScore,
      rentBefore: sa.rentBefore,
      rentAfter: sa.rentAfter,
      setSize: sa.setSize,
    });
  }

  for (const opp of findTwoAwayOpps({
    selfId,
    opponents,
    blocks,
    settings,
    citiesByCountry,
    opponentSampleId,
    selfMoney,
  })) {
    opps.push(opp);
  }

  for (const pa of partnerOneAways) {
    if (pa.missingBlock.ownerId !== selfId) continue;
    if (mutualOfferedBlocks.has(pa.missingBlockIndex)) continue;
    const partner = participants.find((p) => p.id === pa.partnerId);
    const partnerMoney = partner?.money ?? 0;
    opps.push({
      kind: 'singleton-offer',
      partnerId: pa.partnerId,
      wantedBlockIndexes: [],
      offerBlockIndexes: [pa.missingBlockIndex],
      suggestedCash: suggestCash(
        pa.valueScoreToPartner,
        pa.missingBlock.price,
        partnerMoney,
      ),
      valueScore: pa.valueScoreToPartner,
      rentBefore: pa.rentBefore,
      rentAfter: pa.rentAfter,
      partnerSetSize: pa.setSize,
    });
  }

  for (const opp of findAirportOpps({
    selfId,
    opponents,
    blocks,
    opponentSampleId,
    selfMoney,
  })) {
    opps.push(opp);
  }

  opps.sort((a, b) => {
    const ko = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
    if (ko !== 0) return ko;
    return b.valueScore - a.valueScore;
  });

  return opps.slice(0, MAX_OPPORTUNITIES);
}

function groupCitiesByCountry(blocks: Block[]): Map<string, IndexedCity[]> {
  const out = new Map<string, IndexedCity[]>();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b?.type !== 'city') continue;
    const arr = out.get(b.countryId);
    if (arr) arr.push({ block: b, index: i });
    else out.set(b.countryId, [{ block: b, index: i }]);
  }
  return out;
}

interface SelfOneAwayInput {
  selfId: string;
  opponents: Participant[];
  blocks: Block[];
  settings: GameSettings;
  citiesByCountry: Map<string, IndexedCity[]>;
  opponentSampleId: string;
}

function findSelfOneAways(input: SelfOneAwayInput): SelfOneAway[] {
  const { selfId, opponents, blocks, settings, citiesByCountry, opponentSampleId } = input;
  const out: SelfOneAway[] = [];
  for (const [countryId, allCities] of citiesByCountry) {
    if (allCities.length < 2) continue;
    const selfOwned = allCities.filter((c) => c.block.ownerId === selfId);
    if (selfOwned.length !== allCities.length - 1) continue;
    const missing = allCities.find((c) => c.block.ownerId !== selfId);
    if (!missing) continue;
    const partnerId = missing.block.ownerId;
    if (!partnerId) continue;
    if (!opponents.some((o) => o.id === partnerId)) continue;

    const setIndexes = allCities.map((c) => c.index);
    const hypothetical = simulateOwnership(blocks, setIndexes, selfId);
    const { rentBefore, rentAfter } = sumSetRent(
      allCities,
      hypothetical,
      blocks,
      selfId,
      opponentSampleId,
      settings,
    );
    out.push({
      countryId,
      setSize: allCities.length,
      missingBlockIndex: missing.index,
      missingBlock: missing.block,
      partnerId,
      rentBefore,
      rentAfter,
      valueScore: rentAfter - rentBefore,
    });
  }
  return out;
}

interface PartnerOneAwayInput {
  selfId: string;
  opponents: Participant[];
  blocks: Block[];
  settings: GameSettings;
  citiesByCountry: Map<string, IndexedCity[]>;
}

function findPartnerOneAways(input: PartnerOneAwayInput): PartnerOneAway[] {
  const { selfId, opponents, blocks, settings, citiesByCountry } = input;
  const out: PartnerOneAway[] = [];
  for (const opp of opponents) {
    // Pick any non-partner alive participant for rent sampling. selfId is
    // always non-partner so it works as a fallback.
    const partnerSampler =
      opponents.find((o) => o.id !== opp.id)?.id ?? selfId;
    for (const [countryId, allCities] of citiesByCountry) {
      if (allCities.length < 2) continue;
      const partnerOwned = allCities.filter((c) => c.block.ownerId === opp.id);
      if (partnerOwned.length !== allCities.length - 1) continue;
      const missing = allCities.find((c) => c.block.ownerId !== opp.id);
      if (!missing) continue;
      if (missing.block.ownerId === null) continue;

      const setIndexes = allCities.map((c) => c.index);
      const hypothetical = simulateOwnership(blocks, setIndexes, opp.id);
      const { rentBefore, rentAfter } = sumSetRent(
        allCities,
        hypothetical,
        blocks,
        opp.id,
        partnerSampler,
        settings,
      );
      out.push({
        partnerId: opp.id,
        countryId,
        setSize: allCities.length,
        missingBlockIndex: missing.index,
        missingBlock: missing.block,
        rentBefore,
        rentAfter,
        valueScoreToPartner: rentAfter - rentBefore,
      });
    }
  }
  return out;
}

interface TwoAwayInput {
  selfId: string;
  opponents: Participant[];
  blocks: Block[];
  settings: GameSettings;
  citiesByCountry: Map<string, IndexedCity[]>;
  opponentSampleId: string;
  selfMoney: number;
}

function findTwoAwayOpps(input: TwoAwayInput): TwoAwayCityOpp[] {
  const {
    selfId,
    opponents,
    blocks,
    settings,
    citiesByCountry,
    opponentSampleId,
    selfMoney,
  } = input;
  const out: TwoAwayCityOpp[] = [];
  for (const [, allCities] of citiesByCountry) {
    // 2-city sets cannot be 'two-away' from a self perspective in a useful
    // way (self would own zero pieces) — gate on 3+.
    if (allCities.length < 3) continue;
    const selfOwned = allCities.filter((c) => c.block.ownerId === selfId);
    if (selfOwned.length !== allCities.length - 2) continue;
    const missing = allCities.filter((c) => c.block.ownerId !== selfId);
    if (missing.length !== 2) continue;
    const ownerSet = new Set(missing.map((c) => c.block.ownerId));
    if (ownerSet.size !== 1) continue;
    const partnerId = [...ownerSet][0];
    if (!partnerId) continue;
    if (!opponents.some((o) => o.id === partnerId)) continue;

    const setIndexes = allCities.map((c) => c.index);
    const hypothetical = simulateOwnership(blocks, setIndexes, selfId);
    const { rentBefore, rentAfter } = sumSetRent(
      allCities,
      hypothetical,
      blocks,
      selfId,
      opponentSampleId,
      settings,
    );
    const valueScore = rentAfter - rentBefore;
    const totalPrice = missing.reduce((s, c) => s + c.block.price, 0);
    out.push({
      kind: 'two-away',
      partnerId,
      wantedBlockIndexes: missing.map((c) => c.index),
      offerBlockIndexes: [],
      suggestedCash: suggestCash(valueScore, totalPrice, selfMoney),
      valueScore,
      rentBefore,
      rentAfter,
      setSize: allCities.length,
    });
  }
  return out;
}

interface AirportOppInput {
  selfId: string;
  opponents: Participant[];
  blocks: Block[];
  opponentSampleId: string;
  selfMoney: number;
}

function findAirportOpps(input: AirportOppInput): AirportOpp[] {
  const { selfId, opponents, blocks, opponentSampleId, selfMoney } = input;
  const totalAirports = countAirports(blocks);
  const selfAirportCount = countSelfAirports(blocks, selfId);
  if (selfAirportCount === 0) return [];

  const out: AirportOpp[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b?.type !== 'airport') continue;
    if (b.ownerId === selfId) continue;
    if (!b.ownerId) continue;
    if (!opponents.some((o) => o.id === b.ownerId)) continue;

    const hypothetical = blocks.map((blk, j) => {
      if (j !== i) return blk;
      if (blk?.type !== 'airport') return blk;
      const next: AirportBlock = {
        ...blk,
        ownerId: selfId,
        isMortgaged: false,
      };
      return next;
    });

    const rentBefore = sumSelfAirportRent(blocks, selfId, opponentSampleId);
    const rentAfter = sumSelfAirportRent(hypothetical, selfId, opponentSampleId);
    const valueScore = rentAfter - rentBefore;
    if (valueScore <= 0) continue;

    out.push({
      kind: 'airport',
      partnerId: b.ownerId,
      wantedBlockIndexes: [i],
      offerBlockIndexes: [],
      suggestedCash: suggestCash(valueScore, b.price, selfMoney),
      valueScore,
      rentBefore,
      rentAfter,
      selfAirportCountAfter: selfAirportCount + 1,
      totalAirports,
    });
  }
  return out;
}

function sumSelfAirportRent(
  blocks: Block[],
  selfId: string,
  sampleId: string,
): number {
  let total = 0;
  for (const b of blocks) {
    if (b?.type !== 'airport') continue;
    if (b.ownerId !== selfId) continue;
    const r = airportLandingRent(b, sampleId, blocks);
    if (r !== null) total += r;
  }
  return total;
}

function countAirports(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) if (b?.type === 'airport') n++;
  return n;
}

function countSelfAirports(blocks: Block[], selfId: string): number {
  let n = 0;
  for (const b of blocks) {
    if (b?.type === 'airport' && b.ownerId === selfId) n++;
  }
  return n;
}

// Rewrites the given indexes to be owned by `newOwnerId`, with houses razed
// (`level: 0`) and unmortgaged so cityLandingRent applies the post-trade
// monopoly bonus rather than skipping the tile.
function simulateOwnership(
  blocks: Block[],
  indexes: number[],
  newOwnerId: string,
): Block[] {
  const idxSet = new Set(indexes);
  return blocks.map((b, i) => {
    if (!idxSet.has(i)) return b;
    if (b?.type !== 'city') return b;
    const next: CityBlock = {
      ...b,
      ownerId: newOwnerId,
      level: 0,
      isMortgaged: false,
    };
    return next;
  });
}

interface SetRent {
  rentBefore: number;
  rentAfter: number;
}

// Compares "rent collected per opponent landing across the set":
//  - before: only tiles already owned by `monopolyOwnerId`
//  - after:  the same tile set with `monopolyOwnerId` owning all of them (and
//            the doubled-rent rule applying to bare-level cities).
function sumSetRent(
  cities: IndexedCity[],
  hypothetical: Block[],
  baseBlocks: Block[],
  monopolyOwnerId: string,
  sampleLanderId: string,
  settings: GameSettings,
): SetRent {
  let rentBefore = 0;
  let rentAfter = 0;
  for (const c of cities) {
    if (c.block.ownerId === monopolyOwnerId) {
      const r = cityLandingRent(c.block, sampleLanderId, baseBlocks, settings);
      if (r !== null) rentBefore += r;
    }
    const hyp = hypothetical[c.index];
    if (hyp?.type === 'city') {
      const r = cityLandingRent(hyp, sampleLanderId, hypothetical, settings);
      if (r !== null) rentAfter += r;
    }
  }
  return { rentBefore, rentAfter };
}

function suggestCash(
  valueScore: number,
  propertyPrice: number,
  money: number,
): number {
  if (money <= 0) return 0;
  const upperFromValue = valueScore * OFFER_HORIZON;
  const upperFromPrice = propertyPrice * 1.5;
  const cap = Math.floor(money * 0.4);
  const target = Math.max(upperFromValue, upperFromPrice);
  return Math.max(0, Math.min(cap, Math.round(target)));
}

