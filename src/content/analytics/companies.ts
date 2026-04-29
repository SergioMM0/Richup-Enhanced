import type { Block, CompanyBlock } from '@shared/types';

// Standard Monopoly utility-rent rule, mirrored by richup.io: rent = dice_sum
// × 4 if the owner holds one company, × 10 if they hold both. The bid advisor
// passes diceSum=7 (the expected value of two dice) to convert this into an
// expected-rent-per-roll number; pass an actual roll for retrospective uses.
export function companyLandingRent(
  block: CompanyBlock,
  landerId: string,
  blocks: Block[],
  diceSum = 7,
): number | null {
  if (!block.ownerId || block.ownerId === landerId) return null;
  if (block.isMortgaged) return null;
  let owned = 0;
  for (const b of blocks) {
    if (b?.type !== 'company') continue;
    if (b.ownerId !== block.ownerId) continue;
    if (b.isMortgaged) continue;
    owned++;
  }
  if (owned < 1) return null;
  const multiplier = owned >= 2 ? 10 : 4;
  return diceSum * multiplier;
}

export function countOwnedCompanies(
  blocks: Block[],
  ownerId: string,
): number {
  let n = 0;
  for (const b of blocks) {
    if (b?.type === 'company' && b.ownerId === ownerId) n++;
  }
  return n;
}

export function totalCompanies(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) if (b?.type === 'company') n++;
  return n;
}
