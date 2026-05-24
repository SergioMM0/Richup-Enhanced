import type {
  AirportBlock,
  Block,
  CityBlock,
  Participant,
  RootStoreState,
} from '@shared/types';
import { formatMoney } from '../../analytics/player';
import { getCityFlagEmoji } from '../../analytics/flags';
import {
  findTradeOpportunities,
  type TradeKind,
  type TradeOpportunity,
} from '../../analytics/trades';
import type { InfoMenuView, ViewContext } from './types';

const KIND_BADGE: Record<TradeKind, string> = {
  'mutual-swap': '⇄',
  'one-away': '→',
  'two-away': '2×',
  'singleton-offer': '←',
  airport: '✈',
};

const KIND_TITLE: Record<TradeKind, string> = {
  'mutual-swap': 'Mutual swap — both gain monopolies',
  'one-away': 'One property away from a monopoly',
  'two-away': 'Two properties away from a monopoly',
  'singleton-offer': 'Sell your lone piece to complete their set',
  airport: 'Acquire an airport to scale up rent',
};

export class TradesView implements InfoMenuView {
  readonly id = 'trades' as const;
  readonly icon = '🤝';
  readonly label = 'Trades';

  private ctx: ViewContext | null = null;

  attach(ctx: ViewContext): void {
    this.ctx = ctx;
  }

  hasNotification(state: RootStoreState | null): boolean {
    const inner = state?.state;
    const selfId = state?.selfParticipantId;
    if (!inner || !selfId) return false;
    const trades = Array.isArray(inner.trades) ? inner.trades : [];
    return trades.some(
      (t) => t.initiatorId === selfId || t.recipientId === selfId,
    );
  }

  render(state: RootStoreState | null): HTMLElement {
    const root = document.createElement('div');
    root.className = 'info-menu__view-pad';

    if (!state) return this.emptyMessage(root, 'Waiting for game state…');
    const inner = state.state;
    const selfId = state.selfParticipantId;
    const participants = Array.isArray(inner.participants)
      ? inner.participants
      : [];
    const blocks = Array.isArray(inner.blocks) ? inner.blocks : [];
    const settings = inner.settings;
    if (!settings) return this.emptyMessage(root, 'Waiting for game state…');

    const self = participants.find((p) => p.id === selfId);
    if (!self) return this.emptyMessage(root, 'No active perspective');

    const opportunities = findTradeOpportunities({
      selfId: self.id,
      participants,
      blocks,
      settings,
      selfMoney: self.money,
    });

    if (opportunities.length === 0) {
      return this.emptyMessage(root, 'No trade opportunities right now');
    }

    const density = this.ctx?.settings().densityMode ?? 'compact';
    for (const opp of opportunities) {
      root.appendChild(this.renderCard(opp, participants, blocks, self, density));
    }
    return root;
  }

  private renderCard(
    opp: TradeOpportunity,
    participants: Participant[],
    blocks: Block[],
    self: Participant,
    density: 'compact' | 'detailed',
  ): HTMLElement {
    const partner = participants.find((p) => p.id === opp.partnerId);
    const isDetailed = density === 'detailed';

    const card = document.createElement('section');
    card.className = 'info-menu__opp-card';
    if (isDetailed) card.classList.add('info-menu__opp-card--expanded');
    card.style.setProperty('--tab-color', partner?.appearance ?? '#888');

    const head = document.createElement('div');
    head.className = 'info-menu__opp-head';
    head.title = KIND_TITLE[opp.kind];

    const badge = document.createElement('span');
    badge.className = 'info-menu__opp-badge';
    badge.textContent = KIND_BADGE[opp.kind];

    const name = document.createElement('span');
    name.className = 'info-menu__opp-name';
    name.textContent = this.headerTitle(opp, partner);

    const score = document.createElement('span');
    score.className = 'info-menu__opp-score';
    score.textContent = `+${formatMoney(opp.valueScore)}`;
    score.title =
      opp.kind === 'singleton-offer'
        ? "Their rent uplift — your asking-price ceiling"
        : 'Estimated per-landing rent uplift';

    head.appendChild(badge);
    head.appendChild(name);
    head.appendChild(score);
    card.appendChild(head);

    if (!isDetailed) return card;

    const detail = document.createElement('div');
    detail.className = 'info-menu__opp-detail';

    detail.appendChild(
      this.row(
        opp.kind === 'singleton-offer' ? 'Their rent' : 'Your rent',
        `${formatMoney(opp.rentBefore)} → ${formatMoney(opp.rentAfter)}`,
      ),
    );

    for (const idx of opp.wantedBlockIndexes) {
      detail.appendChild(this.row('Get', this.blockLabel(blocks[idx])));
    }
    for (const idx of opp.offerBlockIndexes) {
      detail.appendChild(this.row('Give', this.blockLabel(blocks[idx])));
    }
    if (opp.suggestedCash > 0) {
      const cashLabel =
        opp.kind === 'singleton-offer' ? 'Ask cash' : 'Pay cash';
      detail.appendChild(
        this.row(cashLabel, `~${formatMoney(opp.suggestedCash)}`),
      );
    }

    const summary = this.summaryFor(opp, blocks, self);
    if (summary) {
      const el = document.createElement('div');
      el.className = 'info-menu__opp-summary';
      el.textContent = summary;
      detail.appendChild(el);
    }

    card.appendChild(detail);
    return card;
  }

  private headerTitle(
    opp: TradeOpportunity,
    partner: Participant | undefined,
  ): string {
    const partnerName = partner?.name ?? 'opponent';
    switch (opp.kind) {
      case 'mutual-swap':
        return `Swap with ${partnerName}`;
      case 'one-away':
        return `Ask ${partnerName}`;
      case 'two-away':
        return `Ask ${partnerName} (2 pieces)`;
      case 'singleton-offer':
        return `Offer to ${partnerName}`;
      case 'airport':
        return `Buy from ${partnerName}`;
    }
  }

  private summaryFor(
    opp: TradeOpportunity,
    blocks: Block[],
    self: Participant,
  ): string | null {
    switch (opp.kind) {
      case 'mutual-swap': {
        const give = opp.offerBlockIndexes.length;
        const get = opp.wantedBlockIndexes.length;
        if (give === get) return 'Both gain monopolies — clean swap';
        return `Both gain monopolies — ${give} for ${get}`;
      }
      case 'one-away':
      case 'two-away':
        return this.setSummary(opp.wantedBlockIndexes[0], opp.setSize, blocks, self);
      case 'singleton-offer': {
        const idx = opp.offerBlockIndexes[0];
        const block = idx !== undefined ? blocks[idx] : undefined;
        if (block?.type === 'city') {
          const owned = opp.partnerSetSize - 1;
          return `They own ${owned}/${opp.partnerSetSize} of this set`;
        }
        return null;
      }
      case 'airport':
        return `Airports: ${opp.selfAirportCountAfter - 1}/${opp.totalAirports} → ${opp.selfAirportCountAfter}/${opp.totalAirports}`;
    }
  }

  private setSummary(
    wantedIndex: number | undefined,
    setSize: number,
    blocks: Block[],
    self: Participant,
  ): string | null {
    if (wantedIndex === undefined) return null;
    const block = blocks[wantedIndex];
    if (block?.type !== 'city') return null;
    const owned = setSize - 1;
    return `Completes a ${setSize}-city set (you own ${owned}/${setSize})`;
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

  private row(label: string, value: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'info-menu__row';
    const l = document.createElement('span');
    l.className = 'info-menu__row-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'info-menu__row-value';
    v.textContent = value;
    v.title = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  private emptyMessage(root: HTMLElement, text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'info-menu__empty';
    el.textContent = text;
    root.appendChild(el);
    return root;
  }
}
