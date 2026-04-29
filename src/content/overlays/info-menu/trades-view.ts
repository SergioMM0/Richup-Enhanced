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
import type { InfoMenuView } from './types';

const KIND_BADGE: Record<TradeKind, string> = {
  'mutual-swap': '⇄', // ⇄
  'one-away': '→',     // →
  'two-away': '2×',    // 2×
  'singleton-offer': '←', // ←
  'airport': '✈',      // ✈
};

export class TradesView implements InfoMenuView {
  readonly id = 'trades';
  readonly label = 'Trades';

  renderBody(state: RootStoreState | null): HTMLElement {
    if (!state) return this.emptyMessage('Waiting for game state…');
    const selfId = state.selfParticipantId;
    const participants = state.state?.participants ?? [];
    const blocks = state.state?.blocks ?? [];
    const settings = state.state?.settings;
    const self = participants.find((p) => p.id === selfId);
    if (!self) return this.emptyMessage('Self participant not found');
    if (!settings) return this.emptyMessage('Waiting for game state…');

    const opportunities = findTradeOpportunities({
      selfId,
      participants,
      blocks,
      settings,
      selfMoney: self.money,
    });

    if (opportunities.length === 0) {
      return this.emptyMessage('No trade opportunities right now');
    }

    const container = document.createElement('div');
    for (const o of opportunities) {
      container.appendChild(this.renderCard(o, participants, blocks));
    }
    return container;
  }

  private renderCard(
    opp: TradeOpportunity,
    participants: Participant[],
    blocks: Block[],
  ): HTMLElement {
    const partner = participants.find((p) => p.id === opp.partnerId);
    const card = document.createElement('section');
    card.className = 'info-menu__rank-card';
    card.style.setProperty('--tab-color', partner?.appearance ?? '#888');

    card.appendChild(this.renderHeader(opp, partner));

    const summary = this.summaryFor(opp, blocks);
    if (summary) {
      const el = document.createElement('div');
      el.className = 'info-menu__rank-summary';
      el.textContent = summary;
      card.appendChild(el);
    }

    card.appendChild(this.rentRow(opp));

    for (const idx of opp.wantedBlockIndexes) {
      card.appendChild(this.row('Get', this.blockLabel(blocks[idx])));
    }
    for (const idx of opp.offerBlockIndexes) {
      card.appendChild(this.row('Give', this.blockLabel(blocks[idx])));
    }

    if (opp.suggestedCash > 0) {
      const cashLabel =
        opp.kind === 'singleton-offer' ? 'Ask cash' : 'Pay cash';
      card.appendChild(this.row(cashLabel, `~${formatMoney(opp.suggestedCash)}`));
    }
    return card;
  }

  private renderHeader(
    opp: TradeOpportunity,
    partner: Participant | undefined,
  ): HTMLElement {
    const header = document.createElement('div');
    header.className = 'info-menu__rank-header';

    const badge = document.createElement('span');
    badge.className = 'info-menu__rank-badge';
    badge.textContent = KIND_BADGE[opp.kind];
    badge.title = this.kindTitle(opp.kind);

    const name = document.createElement('span');
    name.className = 'info-menu__rank-name';
    name.textContent = this.headerTitle(opp, partner);
    name.title = name.textContent ?? '';

    const total = document.createElement('span');
    total.className = 'info-menu__rank-total';
    total.textContent = `+${formatMoney(opp.valueScore)}`;
    total.title =
      opp.kind === 'singleton-offer'
        ? 'Estimated rent uplift the partner gains (your asking-price ceiling)'
        : 'Estimated rent uplift per opponent landing on the affected tiles';

    header.appendChild(badge);
    header.appendChild(name);
    header.appendChild(total);
    return header;
  }

  private headerTitle(
    opp: TradeOpportunity,
    partner: Participant | undefined,
  ): string {
    const partnerName = partner?.name ?? 'opponent';
    switch (opp.kind) {
      case 'mutual-swap':
        return `Mutual swap with ${partnerName}`;
      case 'one-away':
        return `Ask ${partnerName}`;
      case 'two-away':
        return `Ask ${partnerName} (2 pieces)`;
      case 'singleton-offer':
        return `Offer to ${partnerName}`;
      case 'airport':
        return `Acquire from ${partnerName}`;
    }
  }

  private kindTitle(kind: TradeKind): string {
    switch (kind) {
      case 'mutual-swap':
        return 'Mutual swap — both gain monopolies';
      case 'one-away':
        return 'One property away from a monopoly';
      case 'two-away':
        return 'Two properties away from a monopoly (single seller)';
      case 'singleton-offer':
        return 'Sell your lone piece to complete their set';
      case 'airport':
        return 'Acquire an airport to scale up rent';
    }
  }

  private summaryFor(opp: TradeOpportunity, blocks: Block[]): string | null {
    switch (opp.kind) {
      case 'mutual-swap': {
        const give = opp.offerBlockIndexes.length;
        const get = opp.wantedBlockIndexes.length;
        if (give === get) {
          return 'Both gain monopolies — clean swap';
        }
        return `Both gain monopolies — ${give} for ${get}`;
      }
      case 'one-away':
        return this.setSummary(opp.wantedBlockIndexes[0], opp.setSize, blocks);
      case 'two-away':
        return this.setSummary(opp.wantedBlockIndexes[0], opp.setSize, blocks);
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
  ): string | null {
    if (wantedIndex === undefined) return null;
    const block = blocks[wantedIndex];
    if (block?.type !== 'city') return null;
    const owned = setSize - 1;
    return `Completes a ${setSize}-city set (you own ${owned}/${setSize})`;
  }

  private rentRow(opp: TradeOpportunity): HTMLElement {
    const text = `${formatMoney(opp.rentBefore)} → ${formatMoney(opp.rentAfter)}`;
    const label =
      opp.kind === 'singleton-offer' ? 'Their rent uplift' : 'Your rent uplift';
    return this.row(label, text);
  }

  private blockLabel(block: Block | undefined): string {
    if (!block) return '?';
    if (block.type === 'city') {
      return this.cityLabel(block);
    }
    if (block.type === 'airport') {
      return this.airportLabel(block);
    }
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
    l.title = label;
    const v = document.createElement('span');
    v.className = 'info-menu__row-value';
    v.textContent = value;
    v.title = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  private emptyMessage(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'info-menu__empty';
    el.textContent = text;
    return el;
  }
}
