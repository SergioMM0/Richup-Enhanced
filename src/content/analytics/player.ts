import type { Block, Participant } from '@shared/types';

export interface NetWorthBreakdown {
  cash: number;
  propertyValue: number;
  total: number;
}

export function calcParticipantNetWorth(
  participant: Participant,
  blocks: Block[],
): NetWorthBreakdown {
  // Liquidation value: properties sell back at half price (mortgage value), and
  // houses/hotels sell back to the bank at half their build cost.
  let propertyValue = 0;
  for (const b of blocks) {
    if (b.type !== 'city' && b.type !== 'airport' && b.type !== 'company') continue;
    if (b.ownerId !== participant.id) continue;
    if (b.isMortgaged) continue;
    propertyValue += b.price / 2;
    if (b.type === 'city') {
      const lvl = b.level;
      if (lvl >= 1 && lvl <= 4) propertyValue += (b.housePrice * lvl) / 2;
      else if (lvl === 5) propertyValue += (b.housePrice * 4 + b.hotelPrice) / 2;
    }
  }
  return {
    cash: participant.money,
    propertyValue,
    total: participant.money + propertyValue,
  };
}

export function formatMoney(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}
