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
import {
  formatRelativeTime,
  tradeInvolvesPlayer,
  type ResolvedEntry,
} from '../../analytics/trade-history';
import type { InfoMenuView, ViewContext } from './types';

interface StatusFilters {
  open: boolean;
  accepted: boolean;
  declined: boolean;
}

export class HistoryView implements InfoMenuView {
  readonly id = 'history' as const;
  readonly icon = '📜';
  readonly label = 'History';

  private ctx: ViewContext | null = null;
  private filters: StatusFilters = { open: true, accepted: true, declined: true };
  // null = "Anyone".
  private filterPlayerId: string | null = null;

  attach(ctx: ViewContext): void {
    this.ctx = ctx;
  }

  resetSession(): void {
    this.filters = { open: true, accepted: true, declined: true };
    this.filterPlayerId = null;
  }

  render(state: RootStoreState | null): HTMLElement {
    const root = document.createElement('div');
    root.className = 'info-menu__view-pad info-menu__history';

    const inner = state?.state;
    const participants = Array.isArray(inner?.participants)
      ? (inner as { participants: Participant[] }).participants
      : [];
    const blocks = Array.isArray(inner?.blocks)
      ? (inner as { blocks: Block[] }).blocks
      : [];
    const openTrades = Array.isArray(inner?.trades)
      ? (inner as { trades: Trade[] }).trades
      : [];
    const resolved = this.ctx?.resolvedEntries() ?? [];

    // Auto-clear an orphaned player filter (selected player no longer in any trade).
    if (this.filterPlayerId !== null) {
      const stillInvolved =
        openTrades.some((t) => tradeInvolvesPlayer(t, this.filterPlayerId)) ||
        resolved.some(
          (e) =>
            e.trade.initiatorId === this.filterPlayerId ||
            e.trade.recipientId === this.filterPlayerId,
        );
      if (!stillInvolved) this.filterPlayerId = null;
    }

    root.appendChild(this.renderFilters(participants, openTrades, resolved));

    const density = this.ctx?.settings().densityMode ?? 'compact';
    if (this.filters.open) {
      root.appendChild(this.renderOpenSection(openTrades, participants, blocks, density));
    }
    if (this.filters.accepted || this.filters.declined) {
      root.appendChild(this.renderResolvedSection(resolved, blocks, density));
    }
    return root;
  }

  // ------------------------------------------------------------------
  // Filter bar
  // ------------------------------------------------------------------

  private renderFilters(
    participants: Participant[],
    openTrades: Trade[],
    resolved: readonly ResolvedEntry[],
  ): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'info-menu__history-filters';

    const segmented = document.createElement('div');
    segmented.className = 'info-menu__segmented';
    segmented.setAttribute('role', 'group');
    segmented.appendChild(this.makeSegment('open', 'Open'));
    segmented.appendChild(this.makeSegment('accepted', 'Accepted'));
    segmented.appendChild(this.makeSegment('declined', 'Declined'));
    bar.appendChild(segmented);

    bar.appendChild(this.renderPlayerDropdown(participants, openTrades, resolved));
    return bar;
  }

  private makeSegment(
    key: keyof StatusFilters,
    label: string,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'info-menu__segment';
    btn.textContent = label;
    btn.setAttribute('aria-pressed', this.filters[key] ? 'true' : 'false');
    btn.addEventListener('click', () => {
      this.filters[key] = !this.filters[key];
      this.ctx?.requestUpdate();
    });
    return btn;
  }

  private renderPlayerDropdown(
    participants: Participant[],
    openTrades: Trade[],
    resolved: readonly ResolvedEntry[],
  ): HTMLElement {
    // Collect ids that appear in any trade (open or resolved) so the dropdown
    // stays scoped to people actually involved.
    const involved = new Set<string>();
    for (const t of openTrades) {
      involved.add(t.initiatorId);
      involved.add(t.recipientId);
    }
    for (const e of resolved) {
      involved.add(e.trade.initiatorId);
      involved.add(e.trade.recipientId);
    }

    const select = document.createElement('select');
    select.className = 'info-menu__history-player';

    const opt = (value: string, label: string, selected: boolean) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      if (selected) o.selected = true;
      return o;
    };

    select.appendChild(opt('', 'Anyone', this.filterPlayerId === null));
    for (const p of participants) {
      if (!involved.has(p.id)) continue;
      select.appendChild(
        opt(p.id, p.name, this.filterPlayerId === p.id),
      );
    }

    select.addEventListener('change', () => {
      this.filterPlayerId = select.value || null;
      this.ctx?.requestUpdate();
    });
    return select;
  }

  // ------------------------------------------------------------------
  // Sections
  // ------------------------------------------------------------------

  private renderOpenSection(
    trades: Trade[],
    participants: Participant[],
    blocks: Block[],
    density: 'compact' | 'detailed',
  ): HTMLElement {
    const filtered = trades.filter((t) =>
      tradeInvolvesPlayer(t, this.filterPlayerId),
    );
    const section = document.createElement('div');
    section.className = 'info-menu__history-section';
    section.appendChild(this.sectionTitle(`Open (${filtered.length})`));
    if (filtered.length === 0) {
      section.appendChild(this.emptyMessage('No open trades'));
      return section;
    }
    for (const t of filtered) {
      section.appendChild(this.renderOpenCard(t, participants, blocks, density));
    }
    return section;
  }

  private renderResolvedSection(
    entries: readonly ResolvedEntry[],
    blocks: Block[],
    density: 'compact' | 'detailed',
  ): HTMLElement {
    const filtered = entries.filter((e) => {
      if (
        this.filterPlayerId !== null &&
        e.trade.initiatorId !== this.filterPlayerId &&
        e.trade.recipientId !== this.filterPlayerId
      ) {
        return false;
      }
      if (e.outcome === 'accepted' && !this.filters.accepted) return false;
      if (e.outcome === 'declined' && !this.filters.declined) return false;
      return true;
    });

    const section = document.createElement('div');
    section.className = 'info-menu__history-section';
    section.appendChild(this.sectionTitle(`Resolved (${filtered.length})`));
    if (filtered.length === 0) {
      section.appendChild(this.emptyMessage('No resolved trades yet'));
      return section;
    }
    for (const e of filtered) {
      section.appendChild(this.renderResolvedCard(e, blocks, density));
    }
    return section;
  }

  // ------------------------------------------------------------------
  // Cards
  // ------------------------------------------------------------------

  private renderOpenCard(
    trade: Trade,
    participants: Participant[],
    blocks: Block[],
    density: 'compact' | 'detailed',
  ): HTMLElement {
    const initiator = participants.find((p) => p.id === trade.initiatorId);
    const recipient = participants.find((p) => p.id === trade.recipientId);

    const card = document.createElement('section');
    card.className = 'info-menu__history-item info-menu__history-item--open';
    if (initiator) card.style.setProperty('--tab-color', initiator.appearance);

    const head = document.createElement('div');
    head.className = 'info-menu__history-head';
    const badge = document.createElement('span');
    badge.className = 'info-menu__history-badge';
    badge.textContent = '⇄';
    const who = document.createElement('span');
    who.className = 'info-menu__history-who';
    who.textContent = `${initiator?.name ?? 'Unknown'} → ${recipient?.name ?? 'Unknown'}`;
    head.appendChild(badge);
    head.appendChild(who);
    card.appendChild(head);

    if (density === 'detailed') {
      card.appendChild(this.tradeSideRows(`${initiator?.name ?? '?'} gives`, trade.initiatorOffer, blocks));
      card.appendChild(this.tradeSideRows(`${recipient?.name ?? '?'} gives`, trade.recipientOffer, blocks));
    }
    return card;
  }

  private renderResolvedCard(
    entry: ResolvedEntry,
    blocks: Block[],
    density: 'compact' | 'detailed',
  ): HTMLElement {
    const card = document.createElement('section');
    card.className = 'info-menu__history-item';
    if (entry.outcome === 'declined') {
      card.classList.add('info-menu__history-item--declined');
    }
    card.style.setProperty(
      '--tab-color',
      entry.outcome === 'accepted' ? entry.initiatorColor : 'var(--rue-fg-mute)',
    );

    const head = document.createElement('div');
    head.className = 'info-menu__history-head';
    const badge = document.createElement('span');
    badge.className = 'info-menu__history-badge';
    badge.textContent = entry.outcome === 'accepted' ? '✓' : '✗';
    const who = document.createElement('span');
    who.className = 'info-menu__history-who';
    who.textContent = `${entry.initiatorName} → ${entry.recipientName}`;
    const when = document.createElement('span');
    when.className = 'info-menu__history-when';
    when.textContent = formatRelativeTime(entry.resolvedAt);
    head.appendChild(badge);
    head.appendChild(who);
    head.appendChild(when);
    card.appendChild(head);

    if (density === 'detailed') {
      card.appendChild(this.tradeSideRows(`${entry.initiatorName} gave`, entry.trade.initiatorOffer, blocks));
      card.appendChild(this.tradeSideRows(`${entry.recipientName} gave`, entry.trade.recipientOffer, blocks));
    } else {
      // Compact: a one-line property summary, no full give/receive.
      const props = [
        ...(entry.trade.initiatorOffer?.propertyIndices ?? []),
        ...(entry.trade.recipientOffer?.propertyIndices ?? []),
      ]
        .map((idx) => this.blockLabel(blocks[idx]))
        .filter(Boolean);
      if (props.length > 0) {
        const sub = document.createElement('div');
        sub.className = 'info-menu__history-sub';
        sub.textContent = props.join(' · ');
        card.appendChild(sub);
      }
    }
    return card;
  }

  private tradeSideRows(
    label: string,
    side: Trade['initiatorOffer'] | undefined,
    blocks: Block[],
  ): HTMLElement {
    const group = document.createElement('div');
    group.className = 'info-menu__history-side';

    const heading = document.createElement('div');
    heading.className = 'info-menu__property-group-title';
    heading.textContent = label;
    group.appendChild(heading);

    const money = typeof side?.money === 'number' ? side.money : 0;
    const indexes = Array.isArray(side?.propertyIndices)
      ? side.propertyIndices
      : [];
    const mortgaged = new Set(
      Array.isArray(side?.mortgagedPropertiesIndexes)
        ? side.mortgagedPropertiesIndexes
        : [],
    );

    if (money > 0) group.appendChild(this.row('Cash', formatMoney(money)));
    for (const idx of indexes) {
      const suffix = mortgaged.has(idx) ? ' (mortgaged)' : '';
      group.appendChild(
        this.row('Property', `${this.blockLabel(blocks[idx])}${suffix}`),
      );
    }
    if (money === 0 && indexes.length === 0) {
      group.appendChild(this.row('—', 'nothing'));
    }
    return group;
  }

  private blockLabel(block: Block | undefined): string {
    if (!block) return '?';
    if (block.type === 'city') return this.cityLabel(block);
    if (block.type === 'airport') return `✈ ${(block as AirportBlock).name}`;
    return block.type;
  }

  private cityLabel(c: CityBlock): string {
    const flag = getCityFlagEmoji(c);
    return flag ? `${flag} ${c.name}` : c.name;
  }

  private sectionTitle(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'info-menu__property-group-title';
    el.textContent = text;
    return el;
  }

  private emptyMessage(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'info-menu__empty';
    el.textContent = text;
    return el;
  }

  private row(label: string, value: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'info-menu__row';
    const l = document.createElement('span');
    l.className = 'info-menu__row-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'info-menu__row-value';
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }
}
