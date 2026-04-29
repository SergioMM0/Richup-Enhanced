import type { Block, BoardConfig } from '@shared/types';

const BOARD_SIZE = 40;

export const DICE_SUMS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

// Probability mass function for the sum of two fair six-sided dice.
// Sums to 1; tabulated to avoid recomputing across hot paths.
export const DIE_PMF: Readonly<Record<number, number>> = {
  2: 1 / 36,
  3: 2 / 36,
  4: 3 / 36,
  5: 4 / 36,
  6: 5 / 36,
  7: 6 / 36,
  8: 5 / 36,
  9: 4 / 36,
  10: 3 / 36,
  11: 2 / 36,
  12: 1 / 36,
};

export interface Prediction {
  tileIndex: number;
  redirected: boolean; // landed on Go-to-Prison, redirected to prison
  uncertain: boolean; // landed on a bonus tile; card may teleport
}

export function predictLanding(
  blocks: Block[],
  boardConfig: BoardConfig | undefined,
  fromPos: number,
  sum: number,
): Prediction {
  const raw = (fromPos + sum) % BOARD_SIZE;
  const block = blocks[raw];
  if (block?.type === 'corner' && block.cornerType === 'go_to_prison') {
    const prison = boardConfig?.prisonBlockIndex ?? 10;
    return { tileIndex: prison, redirected: true, uncertain: false };
  }
  if (block?.type === 'bonus') {
    return { tileIndex: raw, redirected: false, uncertain: true };
  }
  return { tileIndex: raw, redirected: false, uncertain: false };
}

// P(player at fromPos lands on `target` on their next single-roll move).
// Bonus-tile uncertainty is excluded — the auctioned tile is unreachable
// "for sure" via that path, so we don't credit it. Go-to-Prison redirects
// are honored: a sum that would step onto the GTP corner contributes to
// the prison tile's probability, not the corner's.
export function landingProbability(
  blocks: Block[],
  boardConfig: BoardConfig | undefined,
  fromPos: number,
  target: number,
): number {
  let p = 0;
  for (const sum of DICE_SUMS) {
    const pred = predictLanding(blocks, boardConfig, fromPos, sum);
    if (pred.uncertain) continue;
    if (pred.tileIndex === target) p += DIE_PMF[sum]!;
  }
  return p;
}
