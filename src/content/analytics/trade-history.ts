import type { Block, Trade } from '@shared/types';

export type ResolutionKind = 'accepted' | 'declined' | 'counter-offered';

export interface ResolvedEntry {
  trade: Trade;
  outcome: 'accepted' | 'declined';
  resolvedAt: number;
  initiatorName: string;
  initiatorColor: string;
  recipientName: string;
  recipientColor: string;
}

export function tradeInvolvesPlayer(
  trade: Trade,
  id: string | null,
): boolean {
  if (id === null) return true;
  return trade.initiatorId === id || trade.recipientId === id;
}

export function entryInvolvesPlayer(
  entry: { trade: Trade },
  id: string | null,
): boolean {
  return tradeInvolvesPlayer(entry.trade, id);
}

export function formatRelativeTime(
  resolvedAt: number,
  now: number = Date.now(),
): string {
  const deltaMs = Math.max(0, now - resolvedAt);
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function findDisappearedTrades(
  prev: Map<string, Trade>,
  currentIds: Set<string>,
): Trade[] {
  const out: Trade[] = [];
  for (const [id, trade] of prev) {
    if (!currentIds.has(id)) out.push(trade);
  }
  return out;
}

// Classify a disappeared trade. richup represents every counter-offer as a
// brand-new trade id (the old one is discarded), so the disappearance alone
// doesn't mean the trade was actually accepted or declined — it may just have
// been edited. stats.tradesCount increments on creation too, so we can't use
// it. Instead:
//   1. If another trade between the same pair (in either direction) exists in
//      the current snapshot, this was a counter-offer — skip it.
//   2. Else, look for a property ownership flip matching the trade: an
//      initiator-offered property that's now owned by the recipient, or vice
//      versa. richup applies the swap atomically on accept, so the new owner
//      appears on the same tick the trade leaves the list.
//   3. Otherwise, the trade was declined or cancelled.
// Pure-money trades (no properties on either side) can't be reliably
// distinguished from declines via state alone and fall through to 'declined'.
export function inferResolution(
  trade: Trade,
  currentTrades: Trade[],
  prevOwners: Map<number, string | null>,
  currentBlocks: Block[],
): ResolutionKind {
  for (const t of currentTrades) {
    if (t.id === trade.id) continue;
    const samePair =
      (t.initiatorId === trade.initiatorId &&
        t.recipientId === trade.recipientId) ||
      (t.initiatorId === trade.recipientId &&
        t.recipientId === trade.initiatorId);
    if (samePair) return 'counter-offered';
  }

  const initiatorProps = trade.initiatorOffer?.propertyIndices ?? [];
  for (const idx of initiatorProps) {
    const prevOwner = prevOwners.get(idx);
    const cur = currentBlocks[idx];
    if (
      cur &&
      'ownerId' in cur &&
      prevOwner === trade.initiatorId &&
      cur.ownerId === trade.recipientId
    ) {
      return 'accepted';
    }
  }
  const recipientProps = trade.recipientOffer?.propertyIndices ?? [];
  for (const idx of recipientProps) {
    const prevOwner = prevOwners.get(idx);
    const cur = currentBlocks[idx];
    if (
      cur &&
      'ownerId' in cur &&
      prevOwner === trade.recipientId &&
      cur.ownerId === trade.initiatorId
    ) {
      return 'accepted';
    }
  }
  return 'declined';
}
