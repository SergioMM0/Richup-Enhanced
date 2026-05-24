import type {
  AirportBlock,
  CityBlock,
  CompanyBlock,
  RootStoreState,
} from '@shared/types';
import {
  formatMoney,
  rankParticipants,
  type ParticipantHoldings,
  type RankedParticipant,
} from '../../analytics/player';
import { getCityFlagEmoji } from '../../analytics/flags';
import type { InfoMenuView, ViewContext } from './types';

export class PlayersView implements InfoMenuView {
  readonly id = 'players' as const;
  readonly icon = '👤';
  readonly label = 'Players';

  private ctx: ViewContext | null = null;
  private pinnedPlayerId: string | null = null;

  attach(ctx: ViewContext): void {
    this.ctx = ctx;
  }

  resetSession(): void {
    if (this.pinnedPlayerId !== null) {
      this.pinnedPlayerId = null;
      this.dispatchPin(null);
    }
  }

  render(state: RootStoreState | null): HTMLElement {
    const root = document.createElement('div');
    root.className = 'info-menu__player-list';

    if (!state) {
      const empty = document.createElement('div');
      empty.className = 'info-menu__empty';
      empty.textContent = 'Waiting for game state…';
      root.appendChild(empty);
      return root;
    }

    const inner = state.state;
    const participants = Array.isArray(inner.participants) ? inner.participants : [];
    const blocks = Array.isArray(inner.blocks) ? inner.blocks : [];
    const ranked = rankParticipants(participants, blocks);

    if (ranked.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'info-menu__empty';
      empty.textContent = 'No active players';
      root.appendChild(empty);
      return root;
    }

    const currentTurnId = participants[inner.currentPlayerIndex]?.id ?? null;
    for (const r of ranked) {
      root.appendChild(this.renderPlayerRow(r, currentTurnId, inner.stats));
    }
    return root;
  }

  private renderPlayerRow(
    r: RankedParticipant,
    currentTurnId: string | null,
    stats: RootStoreState['state']['stats'] | undefined,
  ): HTMLElement {
    const density = this.ctx?.settings().densityMode ?? 'compact';
    const isDetailed = density === 'detailed';
    const isCurrentTurn = currentTurnId === r.participant.id;
    const isPinned = this.pinnedPlayerId === r.participant.id;

    const row = document.createElement('section');
    let cls = 'info-menu__player-row';
    if (isDetailed) cls += ' info-menu__player-row--expanded';
    if (isCurrentTurn) cls += ' info-menu__player-row--current';
    row.className = cls;
    row.style.setProperty('--tab-color', r.participant.appearance);
    // Tag with participant id so LandingChipsOverlay's hover handler can match.
    row.dataset.participantId = r.participant.id;

    const top = document.createElement('div');
    top.className = 'info-menu__player-row-top';

    const rankBadge = document.createElement('span');
    rankBadge.className = 'info-menu__rank-badge';
    rankBadge.textContent = `#${r.rank}`;

    const name = document.createElement('span');
    name.className = 'info-menu__player-row-name';
    name.textContent = r.participant.name;
    name.title = r.participant.name;

    const total = document.createElement('span');
    total.className = 'info-menu__player-row-total';
    total.textContent = formatMoney(r.breakdown.total);

    top.appendChild(rankBadge);
    top.appendChild(name);
    top.appendChild(total);

    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'info-menu__pin-btn';
    pinBtn.setAttribute('aria-pressed', isPinned ? 'true' : 'false');
    pinBtn.title = isPinned ? 'Unpin landing prediction' : 'Pin landing prediction';
    pinBtn.textContent = '📌';
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePin(r.participant.id);
    });
    top.appendChild(pinBtn);

    row.appendChild(top);

    if (isDetailed) {
      row.appendChild(this.renderPlayerDetail(r, stats));
    }
    return row;
  }

  private renderPlayerDetail(
    r: RankedParticipant,
    stats: RootStoreState['state']['stats'] | undefined,
  ): HTMLElement {
    const detail = document.createElement('div');
    detail.className = 'info-menu__player-row-detail';

    detail.appendChild(this.row('Cash', formatMoney(r.breakdown.cash)));
    detail.appendChild(this.row('Properties', formatMoney(r.breakdown.propertyValue)));
    if (r.breakdown.lockedInSets > 0) {
      detail.appendChild(
        this.row('Locked in sets', formatMoney(r.breakdown.lockedInSets)),
      );
    }

    const density = this.ctx?.settings().densityMode ?? 'compact';
    if (density === 'detailed' && stats) {
      const prison = stats.prisonVisits?.[r.participant.id] ?? 0;
      detail.appendChild(this.row('Prison visits', String(prison)));
    }

    if (r.holdings.totalProperties > 0) {
      detail.appendChild(this.renderHoldings(r.holdings));
    } else {
      const none = document.createElement('div');
      none.className = 'info-menu__empty';
      none.textContent = 'No properties';
      detail.appendChild(none);
    }

    return detail;
  }

  private renderHoldings(h: ParticipantHoldings): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'info-menu__player-holdings';

    if (h.cities.length > 0) {
      wrap.appendChild(this.groupTitle(`Cities (${h.cities.length})`));
      const countries = [...h.citiesByCountry.entries()].sort((a, b) => {
        const aDone = h.completedSets.has(a[0]) ? 0 : 1;
        const bDone = h.completedSets.has(b[0]) ? 0 : 1;
        return aDone - bDone;
      });
      for (const [countryId, cities] of countries) {
        const isSet = h.completedSets.has(countryId);
        for (const c of cities) {
          wrap.appendChild(this.cityRow(c, isSet));
        }
      }
    }

    this.renderFlatGroup(wrap, 'Airports', h.airports);
    this.renderFlatGroup(wrap, 'Companies', h.companies);
    return wrap;
  }

  private renderFlatGroup(
    parent: HTMLElement,
    title: string,
    items: (AirportBlock | CompanyBlock)[],
  ): void {
    if (items.length === 0) return;
    parent.appendChild(this.groupTitle(`${title} (${items.length})`));
    for (const b of items) parent.appendChild(this.simpleFlatRow(b));
  }

  private cityRow(c: CityBlock, isSet: boolean): HTMLElement {
    const flag = getCityFlagEmoji(c);
    const prefix = flag ? `${flag} ` : '';
    const suffix = isSet ? ' ★' : '';
    return this.holdingRow(
      `${prefix}${c.name}${suffix}`,
      this.cityValue(c),
      c.isMortgaged,
    );
  }

  private cityValue(c: CityBlock): string {
    if (c.isMortgaged) return 'Mortgaged';
    if (c.level === 5) return 'Hotel';
    if (c.level >= 1 && c.level <= 4) return `${c.level}H`;
    return '—';
  }

  private simpleFlatRow(b: AirportBlock | CompanyBlock): HTMLElement {
    return this.holdingRow(b.name, b.isMortgaged ? 'Mortgaged' : '—', b.isMortgaged);
  }

  private togglePin(id: string): void {
    this.pinnedPlayerId = this.pinnedPlayerId === id ? null : id;
    this.dispatchPin(this.pinnedPlayerId);
    this.ctx?.requestUpdate();
  }

  private dispatchPin(id: string | null): void {
    document.dispatchEvent(
      new CustomEvent('rue:pin-participant', { detail: { id } }),
    );
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

  private holdingRow(label: string, value: string, mortgaged: boolean): HTMLElement {
    const row = document.createElement('div');
    let cls = 'info-menu__row';
    if (mortgaged) cls += ' info-menu__row--mortgaged';
    row.className = cls;
    const l = document.createElement('span');
    l.className = 'info-menu__row-label';
    l.textContent = label;
    l.title = label;
    const v = document.createElement('span');
    v.className = 'info-menu__row-value';
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  private groupTitle(text: string): HTMLElement {
    const h = document.createElement('div');
    h.className = 'info-menu__property-group-title';
    h.textContent = text;
    return h;
  }
}
