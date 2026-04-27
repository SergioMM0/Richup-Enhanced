import type { Block, CityBlock, Participant } from '@shared/types';

export interface NetWorthBreakdown {
  cash: number;
  propertyValue: number;
  lockedInSets: number;
  total: number;
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

export function formatMoney(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}
