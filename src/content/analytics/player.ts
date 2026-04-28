import type {
  AirportBlock,
  Block,
  CityBlock,
  CompanyBlock,
  Participant,
} from '@shared/types';

export interface NetWorthBreakdown {
  cash: number;
  propertyValue: number;
  lockedInSets: number;
  total: number;
}

export interface ParticipantHoldings {
  participantId: string;
  cities: CityBlock[];
  airports: AirportBlock[];
  companies: CompanyBlock[];
  citiesByCountry: Map<string, CityBlock[]>;
  completedSets: Set<string>;
  totalProperties: number;
  mortgagedCount: number;
  developedCount: number;
}

export interface RankedParticipant {
  participant: Participant;
  rank: number;
  breakdown: NetWorthBreakdown;
  holdings: ParticipantHoldings;
}

export function calcParticipantNetWorth(
  participant: Participant,
  blocks: Block[],
): NetWorthBreakdown {
  const completedSets = getCompletedCitySets(participant.id, blocks);
  // Liquidation value: properties sell back at half price (mortgage value), and
  // houses/hotels sell back to the bank at half their build cost.
  let propertyValue = 0;
  let lockedInSets = 0;
  for (const b of blocks) {
    if (b.type !== 'city' && b.type !== 'airport' && b.type !== 'company') continue;
    if (b.ownerId !== participant.id) continue;
    if (b.isMortgaged) continue;
    let contribution = b.price / 2;
    if (b.type === 'city') {
      const lvl = b.level;
      if (lvl >= 1 && lvl <= 4) contribution += (b.housePrice * lvl) / 2;
      else if (lvl === 5) contribution += (b.housePrice * 4 + b.hotelPrice) / 2;
    }
    propertyValue += contribution;
    if (b.type === 'city' && completedSets.has(b.countryId)) {
      lockedInSets += contribution;
    }
  }
  return {
    cash: participant.money,
    propertyValue,
    lockedInSets,
    total: participant.money + propertyValue,
  };
}

// Singleton "groups" (count <= 1) are excluded so a one-tile country can't
// trivially qualify as a monopoly.
export function getCompletedCitySets(
  participantId: string,
  blocks: Block[],
): Set<string> {
  const groups = new Map<string, CityBlock[]>();
  for (const b of blocks) {
    if (b.type !== 'city') continue;
    const arr = groups.get(b.countryId);
    if (arr) arr.push(b);
    else groups.set(b.countryId, [b]);
  }
  const out = new Set<string>();
  for (const [countryId, cities] of groups) {
    if (cities.length <= 1) continue;
    if (cities.every((c) => c.ownerId === participantId)) out.add(countryId);
  }
  return out;
}

export function getParticipantHoldings(
  participantId: string,
  blocks: Block[],
): ParticipantHoldings {
  const cities: CityBlock[] = [];
  const airports: AirportBlock[] = [];
  const companies: CompanyBlock[] = [];
  const citiesByCountry = new Map<string, CityBlock[]>();
  let mortgagedCount = 0;
  let developedCount = 0;
  for (const b of blocks) {
    if (b.type !== 'city' && b.type !== 'airport' && b.type !== 'company') continue;
    if (b.ownerId !== participantId) continue;
    if (b.isMortgaged) mortgagedCount++;
    if (b.type === 'city') {
      cities.push(b);
      const arr = citiesByCountry.get(b.countryId);
      if (arr) arr.push(b);
      else citiesByCountry.set(b.countryId, [b]);
      if (b.level > 0) developedCount++;
    } else if (b.type === 'airport') {
      airports.push(b);
    } else {
      companies.push(b);
    }
  }
  return {
    participantId,
    cities,
    airports,
    companies,
    citiesByCountry,
    completedSets: getCompletedCitySets(participantId, blocks),
    totalProperties: cities.length + airports.length + companies.length,
    mortgagedCount,
    developedCount,
  };
}

// Standard competition ranking: tied totals share a rank, the next rank skips
// the tied count (e.g. 1, 2, 2, 4). Bankrupt players are excluded — they're
// out of the game and showing them would distort the "who is winning" framing.
export function rankParticipants(
  participants: Participant[],
  blocks: Block[],
): RankedParticipant[] {
  const enriched = participants
    .filter((p) => p.bankruptedAt === null)
    .map((p) => ({
      participant: p,
      breakdown: calcParticipantNetWorth(p, blocks),
      holdings: getParticipantHoldings(p.id, blocks),
    }));
  enriched.sort((a, b) => b.breakdown.total - a.breakdown.total);
  const out: RankedParticipant[] = [];
  for (let i = 0; i < enriched.length; i++) {
    const cur = enriched[i]!;
    const prev = out[i - 1];
    const rank =
      prev && prev.breakdown.total === cur.breakdown.total ? prev.rank : i + 1;
    out.push({ ...cur, rank });
  }
  return out;
}

export function formatMoney(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}
