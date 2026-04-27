import type {
  AirportBlock,
  Block,
  CityBlock,
  GameSettings,
} from '@shared/types';

export function cityLandingRent(
  block: CityBlock,
  hoveredId: string,
  blocks: Block[],
  settings: GameSettings,
): number | null {
  if (!block.ownerId || block.ownerId === hoveredId) return null;
  if (block.isMortgaged) return null;

  const levelKey = String(block.level) as '0' | '1' | '2' | '3' | '4' | '5';
  let rent = block.rentPrices[levelKey];
  if (typeof rent !== 'number') return null;

  if (block.level === 0 && settings.payDoubleRentWhenOwnFullSet) {
    const sameSet = blocks.filter(
      (b): b is CityBlock => b.type === 'city' && b.countryId === block.countryId,
    );
    if (sameSet.length > 1 && sameSet.every((b) => b.ownerId === block.ownerId)) {
      rent *= 2;
    }
  }
  return rent;
}

export function airportLandingRent(
  block: AirportBlock,
  hoveredId: string,
  blocks: Block[],
): number | null {
  if (!block.ownerId || block.ownerId === hoveredId) return null;
  if (block.isMortgaged) return null;

  let count = 0;
  for (const b of blocks) {
    if (b.type === 'airport' && b.ownerId === block.ownerId) count++;
  }
  if (count < 1) return null;
  const rent = block.rentPrices[count - 1];
  return typeof rent === 'number' ? rent : null;
}
