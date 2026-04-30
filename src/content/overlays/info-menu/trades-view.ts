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
  'mutual-swap': '⇄', // ⇄
  'one-away': '→',     // →
  'two-away': '2×',    // 2×
  'singleton-offer': '←', // ←
  'airport': '✈',      // ✈
};

interface ChipEntry {
  wrap: HTMLDivElement;
  el: HTMLButtonElement;
  participant: Participant;
}

export class TradesView implements InfoMenuView {
  readonly id = 'trades';
  readonly label = 'Trades';

  private chipsEl: HTMLDivElement;
  private chips = new Map<string, ChipEntry>();
  private activePerspectiveId: string | null = null;
  private context: ViewContext | null = null;

  constructor() {
    this.chipsEl = document.createElement('div');
    this.chipsEl.className = 'info-menu__chips';
    this.chipsEl.setAttribute('role', 'tablist');
  }

  attach(context: ViewContext): void {
    this.context = context;
  }

  resetSession(): void {
    for (const entry of this.chips.values()) entry.wrap.remove();
    this.chips.clear();
    this.activePerspectiveId = null;
  }

  renderSubHeader(state: RootStoreState | null): HTMLElement | null {
    const participants = state?.state?.participants ?? [];
    const active = participants.filter((p) => p.bankruptedAt === null);
    this.ensureActivePerspective(active, state?.selfParticipantId ?? '');
    this.reconcileChips(active);
    return this.chipsEl;
  }

  renderBody(state: RootStoreState | null): HTMLElement {
    if (!state) return this.emptyMessage('Waiting for game state…');
    const selfId = state.selfParticipantId;
    const participants = state.state?.participants ?? [];
    const blocks = state.state?.blocks ?? [];
    const settings = state.state?.settings;
    if (!settings) return this.emptyMessage('Waiting for game state…');

    const activeId = this.activePerspectiveId ?? selfId;
    const perspective = participants.find((p) => p.id === activeId);
    if (!perspective) return this.emptyMessage('No active players');

    const opportunities = findTradeOpportunities({
      selfId: perspective.id,
      participants,
      blocks,
      settings,
      selfMoney: perspective.money,
    });

    if (opportunities.length === 0) {
      return this.emptyMessage('No trade opportunities right now');
    }

    const isSelf = perspective.id === selfId;
    const container = document.createElement('div');
    for (const o of opportunities) {
      container.appendChild(
        this.renderCard(o, participants, blocks, perspective, isSelf),
      );
    }
    return container;
  }

  private ensureActivePerspective(
    active: Participant[],
    selfId: string,
  ): void {
    const stillActive = this.activePerspectiveId
      ? active.some((p) => p.id === this.activePerspectiveId)
      : false;
    if (stillActive) return;
    const fallback = active[0];
    if (!fallback) return;
    const self = active.find((p) => p.id === selfId);
    this.activePerspectiveId = (self ?? fallback).id;
  }

  private reconcileChips(active: Participant[]): void {
    const seen = new Set<string>();
    for (const p of active) {
      seen.add(p.id);
      let entry = this.chips.get(p.id);
      if (!entry) {
        const wrap = document.createElement('div');
        wrap.className = 'info-menu__chip-wrap';

        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'info-menu__chip';
        el.setAttribute('role', 'tab');
        el.addEventListener('click', () => {
          this.activePerspectiveId = p.id;
          this.context?.requestUpdate();
        });

        wrap.appendChild(el);
        this.chipsEl.appendChild(wrap);
        entry = { wrap, el, participant: p };
        this.chips.set(p.id, entry);
      }
      entry.participant = p;
      entry.wrap.style.setProperty('--tab-color', p.appearance);
      entry.el.style.setProperty('--tab-color', p.appearance);
      entry.el.textContent = p.name;
      entry.el.title = p.name;
      const isActive = p.id === this.activePerspectiveId;
      entry.el.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
    for (const id of [...this.chips.keys()]) {
      if (!seen.has(id)) {
        this.chips.get(id)?.wrap.remove();
        this.chips.delete(id);
      }
    }
  }

  private renderCard(
    opp: TradeOpportunity,
    participants: Participant[],
    blocks: Block[],
    perspective: Participant,
    isSelf: boolean,
  ): HTMLElement {
    const partner = participants.find((p) => p.id === opp.partnerId);
    const card = document.createElement('section');
    card.className = 'info-menu__rank-card';
    card.style.setProperty('--tab-color', partner?.appearance ?? '#888');

    card.appendChild(this.renderHeader(opp, partner));

    const summary = this.summaryFor(opp, blocks, perspective, isSelf);
    if (summary) {
      const el = document.createElement('div');
      el.className = 'info-menu__rank-summary';
      el.textContent = summary;
      card.appendChild(el);
    }

    card.appendChild(this.rentRow(opp, perspective, isSelf));

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

  private summaryFor(
    opp: TradeOpportunity,
    blocks: Block[],
    perspective: Participant,
    isSelf: boolean,
  ): string | null {
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
        return this.setSummary(
          opp.wantedBlockIndexes[0],
          opp.setSize,
          blocks,
          perspective,
          isSelf,
        );
      case 'two-away':
        return this.setSummary(
          opp.wantedBlockIndexes[0],
          opp.setSize,
          blocks,
          perspective,
          isSelf,
        );
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
    perspective: Participant,
    isSelf: boolean,
  ): string | null {
    if (wantedIndex === undefined) return null;
    const block = blocks[wantedIndex];
    if (block?.type !== 'city') return null;
    const owned = setSize - 1;
    const ownership = isSelf
      ? `you own ${owned}/${setSize}`
      : `${perspective.name} owns ${owned}/${setSize}`;
    return `Completes a ${setSize}-city set (${ownership})`;
  }

  private rentRow(
    opp: TradeOpportunity,
    perspective: Participant,
    isSelf: boolean,
  ): HTMLElement {
    const text = `${formatMoney(opp.rentBefore)} → ${formatMoney(opp.rentAfter)}`;
    let label: string;
    if (opp.kind === 'singleton-offer') {
      label = 'Their rent uplift';
    } else if (isSelf) {
      label = 'Your rent uplift';
    } else {
      label = `${perspective.name}'s rent uplift`;
    }
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
