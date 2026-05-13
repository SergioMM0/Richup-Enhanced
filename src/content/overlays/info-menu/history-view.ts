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
import type { InfoMenuView } from './types';

const MAX_VISIBLE_RESOLVED = 50;

export interface ResolvedTrade {
  trade: Trade;
  outcome: 'accepted' | 'declined';
}

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

// Pure diff between two trade snapshots. Trades that disappeared from the
// current snapshot are reported as resolved. Acceptance is inferred from the
// delta in stats.tradesCount on the same tick — the host increments that
// counter on accept, not on decline/cancel. When multiple trades resolve in
// the same tick we can't attribute the delta to specific ids, so we burn the
// budget greedily across the resolved list (first N marked accepted, rest
// declined). prevCount === null means this is our first observation so we
// can't credit anything yet — everything resolved on this tick is declined.
export function diffTrades(args: {
  prev: Map<string, Trade>;
  currentIds: Set<string>;
  prevCount: number | null;
  currentCount: number;
}): ResolvedTrade[] {
  const resolved: Trade[] = [];
  for (const [id, trade] of args.prev) {
    if (!args.currentIds.has(id)) resolved.push(trade);
  }
  if (resolved.length === 0) return [];
  let acceptedBudget =
    args.prevCount === null
      ? 0
      : Math.max(0, args.currentCount - args.prevCount);
  return resolved.map((trade) => {
    const accepted = acceptedBudget > 0;
    if (accepted) acceptedBudget--;
    return { trade, outcome: accepted ? 'accepted' : 'declined' };
  });
}

export class HistoryView implements InfoMenuView {
  readonly id = 'history';
  readonly label = 'History';

  private prevTradeIds = new Map<string, Trade>();
  private prevTradesCount: number | null = null;
  private entries: ResolvedEntry[] = [];
  // Bankrupt players can stay in participants[] but their data may be stale
  // by the time we render a card for an old trade. Snapshot name/color on
  // every tick so the resolved log always renders with the values that were
  // current when the trade existed.
  private participantSnapshot = new Map<string, ParticipantSnapshot>();

  observeState(state: RootStoreState | null): void {
    try {
      this.observeStateInner(state);
    } catch (err) {
      console.error('[RUE] HistoryView.observeState crashed', err, {
        hasState: !!state,
        tradesSample: state?.state?.trades,
      });
    }
  }

  // One-time debug dump so we can see what the host's actual Trade shape is.
  // Documented Trade { offer, request } turned out to be wrong at runtime —
  // log the first non-empty sample so we can update the renderer.
  private didDumpSample = false;

  private observeStateInner(state: RootStoreState | null): void {
    const inner = state?.state;
    if (!inner) return;
    if (inner.phase !== 'playing' && inner.phase !== 'ended') return;

    if (
      !this.didDumpSample &&
      Array.isArray(inner.trades) &&
      inner.trades.length > 0
    ) {
      this.didDumpSample = true;
      const sample = inner.trades[0];
      console.log('[RUE history] live trade sample', {
        keys: sample ? Object.keys(sample) : [],
        sample,
        tradesCount: inner.stats?.tradesCount,
      });
    }

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
    const currentCount = inner.stats?.tradesCount ?? 0;

    const resolved = diffTrades({
      prev: this.prevTradeIds,
      currentIds,
      prevCount: this.prevTradesCount,
      currentCount,
    });

    if (resolved.length > 0) {
      const now = Date.now();
      // Resolved are returned in iteration order; unshift in reverse so the
      // earliest resolved on this tick ends up below the latest in the log.
      for (let i = resolved.length - 1; i >= 0; i--) {
        const r = resolved[i]!;
        const initiator = this.participantSnapshot.get(r.trade.initiatorId);
        const recipient = this.participantSnapshot.get(r.trade.recipientId);
        this.entries.unshift({
          trade: r.trade,
          outcome: r.outcome,
          resolvedAt: now,
          initiatorName: initiator?.name ?? 'Unknown',
          initiatorColor: initiator?.color ?? '#888',
          recipientName: recipient?.name ?? 'Unknown',
          recipientColor: recipient?.color ?? '#888',
        });
      }
    }

    const next = new Map<string, Trade>();
    for (const t of currentTrades) next.set(t.id, t);
    this.prevTradeIds = next;
    this.prevTradesCount = currentCount;
  }

  resetSession(): void {
    this.prevTradeIds.clear();
    this.prevTradesCount = null;
    this.entries = [];
    this.participantSnapshot.clear();
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

      container.appendChild(
        this.renderOpenSection(openTrades, participants, blocks),
      );
      container.appendChild(this.renderResolvedSection(blocks));
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

  private renderOpenSection(
    trades: Trade[],
    participants: Participant[],
    blocks: Block[],
  ): HTMLElement {
    const section = document.createElement('div');
    section.className = 'info-menu__section';

    const title = document.createElement('div');
    title.className = 'info-menu__section-title';
    title.textContent = `Open (${trades.length})`;
    section.appendChild(title);

    if (trades.length === 0) {
      section.appendChild(this.emptyMessage('No open trade offers'));
      return section;
    }
    for (const t of trades) {
      section.appendChild(this.renderOpenCard(t, participants, blocks));
    }
    return section;
  }

  private renderResolvedSection(blocks: Block[]): HTMLElement {
    const section = document.createElement('div');
    section.className = 'info-menu__section';

    const title = document.createElement('div');
    title.className = 'info-menu__section-title';
    title.textContent = `Resolved (${this.entries.length})`;
    section.appendChild(title);

    if (this.entries.length === 0) {
      section.appendChild(this.emptyMessage('No resolved trades yet'));
      return section;
    }
    const visible = this.entries.slice(0, MAX_VISIBLE_RESOLVED);
    for (const e of visible) {
      section.appendChild(this.renderResolvedCard(e, blocks));
    }
    if (this.entries.length > MAX_VISIBLE_RESOLVED) {
      const more = document.createElement('div');
      more.className = 'info-menu__empty';
      more.textContent = `+${this.entries.length - MAX_VISIBLE_RESOLVED} earlier`;
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
    summary.textContent = this.summaryForResolved(entry);
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
    const indexes = Array.isArray(side?.blockIndexes) ? side.blockIndexes : [];
    if (money > 0) card.appendChild(this.row('Cash', formatMoney(money)));
    for (const idx of indexes) {
      card.appendChild(this.row('Property', this.blockLabel(blocks[idx])));
    }
    if (money === 0 && indexes.length === 0) {
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
