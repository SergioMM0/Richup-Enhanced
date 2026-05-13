import type {
  AirportBlock,
  Block,
  CityBlock,
  Participant,
  RootStoreState,
  Trade,
} from '@shared/types';
import { formatMoney } from '../../analytics/player';
import { getCityFlagEmoji } from '../../analytics/flags';
import type { InfoMenuView, ViewContext } from './types';

const MAX_VISIBLE_RESOLVED = 50;

export type ResolutionKind = 'accepted' | 'declined' | 'counter-offered';

interface ResolvedEntry {
  trade: Trade;
  outcome: 'accepted' | 'declined';
  resolvedAt: number;
  initiatorName: string;
  initiatorColor: string;
  recipientName: string;
  recipientColor: string;
}

interface ParticipantSnapshot {
  name: string;
  color: string;
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

// Trades that left the active list since the previous snapshot.
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

export class HistoryView implements InfoMenuView {
  readonly id = 'history';
  readonly label = 'History';

  private prevTradeIds = new Map<string, Trade>();
  private prevOwners = new Map<number, string | null>();
  private entries: ResolvedEntry[] = [];
  // Bankrupt players can stay in participants[] but their data may be stale
  // by the time we render a card for an old trade. Snapshot name/color on
  // every tick so the resolved log always renders with the values that were
  // current when the trade existed.
  private participantSnapshot = new Map<string, ParticipantSnapshot>();
  private context: ViewContext | null = null;
  private selectedPlayerId: string | null = null;
  private filters = { open: true, accepted: true, declined: true };

  attach(context: ViewContext): void {
    this.context = context;
  }

  observeState(state: RootStoreState | null): void {
    try {
      this.observeStateInner(state);
    } catch (err) {
      console.error('[RUE] HistoryView.observeState crashed', err, {
        hasState: !!state,
      });
    }
  }

  private observeStateInner(state: RootStoreState | null): void {
    const inner = state?.state;
    if (!inner) return;
    if (inner.phase !== 'playing' && inner.phase !== 'ended') return;

    if (Array.isArray(inner.participants)) {
      for (const p of inner.participants) {
        this.participantSnapshot.set(p.id, {
          name: p.name,
          color: p.appearance,
        });
      }
    }

    const currentTrades = Array.isArray(inner.trades) ? inner.trades : [];
    const currentIds = new Set(currentTrades.map((t) => t.id));
    const currentBlocks = Array.isArray(inner.blocks) ? inner.blocks : [];

    const disappeared = findDisappearedTrades(this.prevTradeIds, currentIds);
    if (disappeared.length > 0) {
      const now = Date.now();
      // Latest disappearance ends up at the top of the log; iterate in reverse
      // and unshift so the array order is newest-first.
      for (let i = disappeared.length - 1; i >= 0; i--) {
        const trade = disappeared[i]!;
        const kind = inferResolution(
          trade,
          currentTrades,
          this.prevOwners,
          currentBlocks,
        );
        if (kind === 'counter-offered') continue;
        const initiator = this.participantSnapshot.get(trade.initiatorId);
        const recipient = this.participantSnapshot.get(trade.recipientId);
        this.entries.unshift({
          trade,
          outcome: kind,
          resolvedAt: now,
          initiatorName: initiator?.name ?? 'Unknown',
          initiatorColor: initiator?.color ?? '#888',
          recipientName: recipient?.name ?? 'Unknown',
          recipientColor: recipient?.color ?? '#888',
        });
      }
    }

    const nextTrades = new Map<string, Trade>();
    for (const t of currentTrades) nextTrades.set(t.id, t);
    this.prevTradeIds = nextTrades;

    this.prevOwners.clear();
    for (let i = 0; i < currentBlocks.length; i++) {
      const b = currentBlocks[i];
      this.prevOwners.set(i, b && 'ownerId' in b ? b.ownerId : null);
    }
  }

  resetSession(): void {
    this.prevTradeIds.clear();
    this.prevOwners.clear();
    this.entries = [];
    this.participantSnapshot.clear();
    this.selectedPlayerId = null;
    this.filters = { open: true, accepted: true, declined: true };
  }

  renderSubHeader(state: RootStoreState | null): HTMLElement | null {
    const inner = state?.state;
    const liveParticipants: Participant[] = Array.isArray(inner?.participants)
      ? inner!.participants
      : [];
    const liveTrades: Trade[] = Array.isArray(inner?.trades)
      ? inner!.trades
      : [];

    const involved = new Set<string>();
    for (const t of liveTrades) {
      involved.add(t.initiatorId);
      involved.add(t.recipientId);
    }
    for (const e of this.entries) {
      involved.add(e.trade.initiatorId);
      involved.add(e.trade.recipientId);
    }

    // Auto-clear an orphaned selection (player no longer appears in any trade).
    if (
      this.selectedPlayerId !== null &&
      !involved.has(this.selectedPlayerId)
    ) {
      this.selectedPlayerId = null;
    }

    const rail = document.createElement('div');
    rail.className = 'info-menu__chips';
    rail.setAttribute('role', 'tablist');

    rail.appendChild(
      this.makePlayerChip(null, 'All', '#888'),
    );

    // Live participants first, in turn order, then any snapshot-only ids
    // (bankrupt or kicked players who still have history).
    const emitted = new Set<string>();
    for (const p of liveParticipants) {
      if (!involved.has(p.id)) continue;
      this.participantSnapshot.set(p.id, {
        name: p.name,
        color: p.appearance,
      });
      rail.appendChild(this.makePlayerChip(p.id, p.name, p.appearance));
      emitted.add(p.id);
    }
    for (const [id, snap] of this.participantSnapshot) {
      if (!involved.has(id) || emitted.has(id)) continue;
      rail.appendChild(this.makePlayerChip(id, snap.name, snap.color));
    }

    return rail;
  }

  private makePlayerChip(
    id: string | null,
    label: string,
    color: string,
  ): HTMLButtonElement {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'info-menu__chip';
    chip.setAttribute('role', 'tab');
    chip.style.setProperty('--tab-color', color);
    chip.textContent = label;
    chip.title = label;
    const isActive = this.selectedPlayerId === id;
    chip.setAttribute('aria-selected', isActive ? 'true' : 'false');
    chip.addEventListener('click', () => {
      this.selectedPlayerId =
        this.selectedPlayerId === id ? null : id;
      this.context?.requestUpdate();
    });
    return chip;
  }

  renderBody(state: RootStoreState | null): HTMLElement {
    const container = document.createElement('div');
    try {
      const inner = state?.state;
      if (!inner) {
        container.appendChild(this.emptyMessage('Waiting for game state…'));
        return container;
      }
      const participants = Array.isArray(inner.participants)
        ? inner.participants
        : [];
      const blocks = Array.isArray(inner.blocks) ? inner.blocks : [];
      const openTrades = Array.isArray(inner.trades) ? inner.trades : [];

      container.appendChild(this.renderStatusToggles());
      if (this.filters.open) {
        container.appendChild(
          this.renderOpenSection(openTrades, participants, blocks),
        );
      }
      if (this.filters.accepted || this.filters.declined) {
        container.appendChild(this.renderResolvedSection(blocks));
      }
    } catch (err) {
      console.error('[RUE] HistoryView.renderBody crashed', err, {
        hasState: !!state,
        hasInner: !!state?.state,
        tradesType: typeof state?.state?.trades,
      });
      container.replaceChildren(
        this.emptyMessage('Render failed — check the console'),
      );
    }
    return container;
  }

  private renderStatusToggles(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'info-menu__chips info-menu__chips--status';
    row.style.marginBottom = '10px';

    row.appendChild(
      this.makeStatusToggle('open', 'Open', '#60a5fa'),
    );
    row.appendChild(
      this.makeStatusToggle('accepted', '✓ Accepted', '#4ade80'),
    );
    row.appendChild(
      this.makeStatusToggle('declined', '✗ Declined', '#f87171'),
    );
    return row;
  }

  private makeStatusToggle(
    key: 'open' | 'accepted' | 'declined',
    label: string,
    color: string,
  ): HTMLButtonElement {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'info-menu__chip';
    chip.style.setProperty('--tab-color', color);
    chip.textContent = label;
    chip.title = label;
    const isOn = this.filters[key];
    chip.setAttribute('aria-selected', isOn ? 'true' : 'false');
    chip.addEventListener('click', () => {
      this.filters[key] = !this.filters[key];
      this.context?.requestUpdate();
    });
    return chip;
  }

  private playerNameForEmpty(): string | null {
    if (this.selectedPlayerId === null) return null;
    const snap = this.participantSnapshot.get(this.selectedPlayerId);
    return snap?.name ?? null;
  }

  private renderOpenSection(
    trades: Trade[],
    participants: Participant[],
    blocks: Block[],
  ): HTMLElement {
    const filtered = trades.filter((t) =>
      tradeInvolvesPlayer(t, this.selectedPlayerId),
    );

    const section = document.createElement('div');
    section.className = 'info-menu__section';

    const title = document.createElement('div');
    title.className = 'info-menu__section-title';
    title.textContent = `Open (${filtered.length})`;
    section.appendChild(title);

    if (filtered.length === 0) {
      const name = this.playerNameForEmpty();
      section.appendChild(
        this.emptyMessage(
          name ? `No open trades involving ${name}` : 'No open trade offers',
        ),
      );
      return section;
    }
    for (const t of filtered) {
      section.appendChild(this.renderOpenCard(t, participants, blocks));
    }
    return section;
  }

  private renderResolvedSection(blocks: Block[]): HTMLElement {
    const filtered = this.entries.filter((e) => {
      if (!entryInvolvesPlayer(e, this.selectedPlayerId)) return false;
      if (e.outcome === 'accepted' && !this.filters.accepted) return false;
      if (e.outcome === 'declined' && !this.filters.declined) return false;
      return true;
    });

    const section = document.createElement('div');
    section.className = 'info-menu__section';

    const title = document.createElement('div');
    title.className = 'info-menu__section-title';
    title.textContent = `Resolved (${filtered.length})`;
    section.appendChild(title);

    if (filtered.length === 0) {
      const name = this.playerNameForEmpty();
      section.appendChild(
        this.emptyMessage(
          name
            ? `No resolved trades involving ${name}`
            : 'No resolved trades yet',
        ),
      );
      return section;
    }
    const visible = filtered.slice(0, MAX_VISIBLE_RESOLVED);
    for (const e of visible) {
      section.appendChild(this.renderResolvedCard(e, blocks));
    }
    if (filtered.length > MAX_VISIBLE_RESOLVED) {
      const more = document.createElement('div');
      more.className = 'info-menu__empty';
      more.textContent = `+${filtered.length - MAX_VISIBLE_RESOLVED} earlier`;
      section.appendChild(more);
    }
    return section;
  }

  private renderOpenCard(
    trade: Trade,
    participants: Participant[],
    blocks: Block[],
  ): HTMLElement {
    const initiator = participants.find((p) => p.id === trade.initiatorId);
    const recipient = participants.find((p) => p.id === trade.recipientId);
    const initiatorSnap = this.participantSnapshot.get(trade.initiatorId);
    const recipientSnap = this.participantSnapshot.get(trade.recipientId);
    const initiatorName =
      initiator?.name ?? initiatorSnap?.name ?? 'Unknown';
    const recipientName =
      recipient?.name ?? recipientSnap?.name ?? 'Unknown';
    const initiatorColor =
      initiator?.appearance ?? initiatorSnap?.color ?? '#888';

    const card = document.createElement('section');
    card.className = 'info-menu__rank-card';
    card.style.setProperty('--tab-color', initiatorColor);

    card.appendChild(
      this.renderHeader('⇄', `${initiatorName} → ${recipientName}`),
    );
    this.appendOfferRows(card, trade, initiatorName, recipientName, blocks);
    return card;
  }

  private renderResolvedCard(entry: ResolvedEntry, blocks: Block[]): HTMLElement {
    const card = document.createElement('section');
    card.className = 'info-menu__rank-card';
    // Accepted cards keep the initiator's color; declined ones go neutral so
    // the row reads as "no money moved" at a glance.
    const accent = entry.outcome === 'accepted' ? entry.initiatorColor : '#666';
    card.style.setProperty('--tab-color', accent);

    const badge = entry.outcome === 'accepted' ? '✓' : '✗';
    card.appendChild(
      this.renderHeader(
        badge,
        `${entry.initiatorName} → ${entry.recipientName}`,
      ),
    );

    const summary = document.createElement('div');
    summary.className = 'info-menu__rank-summary';
    summary.textContent = `${this.summaryForResolved(entry)} • ${formatRelativeTime(entry.resolvedAt)}`;
    card.appendChild(summary);

    this.appendOfferRows(
      card,
      entry.trade,
      entry.initiatorName,
      entry.recipientName,
      blocks,
    );
    return card;
  }

  private summaryForResolved(entry: ResolvedEntry): string {
    if (entry.outcome === 'declined') return 'Declined / cancelled';
    const initiatorCash = entry.trade.initiatorOffer?.money ?? 0;
    const recipientCash = entry.trade.recipientOffer?.money ?? 0;
    const netForInitiator = recipientCash - initiatorCash;
    if (netForInitiator > 0) {
      return `Accepted • +${formatMoney(netForInitiator)} to ${entry.initiatorName}`;
    }
    if (netForInitiator < 0) {
      return `Accepted • +${formatMoney(-netForInitiator)} to ${entry.recipientName}`;
    }
    return 'Accepted';
  }

  private appendOfferRows(
    card: HTMLElement,
    trade: Trade,
    initiatorName: string,
    recipientName: string,
    blocks: Block[],
  ): void {
    card.appendChild(this.groupTitle(`${initiatorName} gives`));
    this.appendSideRows(card, trade.initiatorOffer, blocks);

    card.appendChild(this.groupTitle(`${recipientName} gives`));
    this.appendSideRows(card, trade.recipientOffer, blocks);
  }

  private appendSideRows(
    card: HTMLElement,
    side: Trade['initiatorOffer'] | undefined,
    blocks: Block[],
  ): void {
    const money = typeof side?.money === 'number' ? side.money : 0;
    const indexes = Array.isArray(side?.propertyIndices)
      ? side.propertyIndices
      : [];
    const mortgaged = new Set(
      Array.isArray(side?.mortgagedPropertiesIndexes)
        ? side.mortgagedPropertiesIndexes
        : [],
    );
    if (money > 0) card.appendChild(this.row('Cash', formatMoney(money)));
    for (const idx of indexes) {
      const label = this.blockLabel(blocks[idx]);
      const suffix = mortgaged.has(idx) ? ' (mortgaged)' : '';
      card.appendChild(this.row('Property', `${label}${suffix}`));
    }
    const pardons = Array.isArray(side?.pardonCards) ? side.pardonCards : [];
    if (pardons.length > 0) {
      card.appendChild(this.row('Pardon cards', String(pardons.length)));
    }
    if (money === 0 && indexes.length === 0 && pardons.length === 0) {
      card.appendChild(this.row('—', 'nothing'));
    }
  }

  private renderHeader(badgeText: string, name: string): HTMLElement {
    const header = document.createElement('div');
    header.className = 'info-menu__rank-header';

    const badge = document.createElement('span');
    badge.className = 'info-menu__rank-badge';
    badge.textContent = badgeText;

    const nameEl = document.createElement('span');
    nameEl.className = 'info-menu__rank-name';
    nameEl.textContent = name;
    nameEl.title = name;

    header.appendChild(badge);
    header.appendChild(nameEl);
    return header;
  }

  private groupTitle(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'info-menu__property-group-title';
    el.textContent = text;
    return el;
  }

  private row(label: string, value: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'info-menu__row';
    const l = document.createElement('span');
    l.className = 'info-menu__row-label';
    l.textContent = label;
    l.title = label;
    const v = document.createElement('span');
    v.className = 'info-menu__row-value';
    v.textContent = value;
    v.title = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  private blockLabel(block: Block | undefined): string {
    if (!block) return '?';
    if (block.type === 'city') return this.cityLabel(block);
    if (block.type === 'airport') return this.airportLabel(block);
    return block.type;
  }

  private cityLabel(c: CityBlock): string {
    const flag = getCityFlagEmoji(c);
    return flag ? `${flag} ${c.name}` : c.name;
  }

  private airportLabel(a: AirportBlock): string {
    return `✈ ${a.name}`;
  }

  private emptyMessage(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'info-menu__empty';
    el.textContent = text;
    return el;
  }
}
