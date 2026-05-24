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
    _stats: RootStoreState['state']['stats'] | undefined,
  ): HTMLElement {
    const detail = document.createElement('div');
    detail.className = 'info-menu__player-row-detail';

    detail.appendChild(this.renderMoneyLine(r.breakdown.cash, r.breakdown.propertyValue));

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

  // Single horizontal line: cash + property value. Locked-in-sets value and
  // prison visits intentionally dropped — the ★ on a complete-set flag below
  // already signals the relevant set state, and prison visits don't drive
  // decisions.
  private renderMoneyLine(cash: number, properties: number): HTMLElement {
    const line = document.createElement('div');
    line.className = 'info-menu__player-money';

    const cashEl = document.createElement('span');
    cashEl.className = 'info-menu__player-money-item';
    cashEl.innerHTML = '';
    const cashIcon = document.createElement('span');
    cashIcon.className = 'info-menu__player-money-icon';
    cashIcon.textContent = '💰';
    const cashVal = document.createElement('span');
    cashVal.className = 'info-menu__player-money-val';
    cashVal.textContent = formatMoney(cash);
    cashEl.appendChild(cashIcon);
    cashEl.appendChild(cashVal);
    cashEl.title = 'Cash on hand';

    const propEl = document.createElement('span');
    propEl.className = 'info-menu__player-money-item';
    const propIcon = document.createElement('span');
    propIcon.className = 'info-menu__player-money-icon';
    propIcon.textContent = '🏛';
    const propVal = document.createElement('span');
    propVal.className = 'info-menu__player-money-val';
    propVal.textContent = formatMoney(properties);
    propEl.appendChild(propIcon);
    propEl.appendChild(propVal);
    propEl.title = 'Property liquidation value';

    line.appendChild(cashEl);
    line.appendChild(propEl);
    return line;
  }

  private renderHoldings(h: ParticipantHoldings): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'info-menu__player-holdings';

    // Cities — group by country. Completed sets float to the top.
    if (h.cities.length > 0) {
      const countries = [...h.citiesByCountry.entries()].sort((a, b) => {
        const aDone = h.completedSets.has(a[0]) ? 0 : 1;
        const bDone = h.completedSets.has(b[0]) ? 0 : 1;
        return aDone - bDone;
      });
      for (const [countryId, cities] of countries) {
        const isSet = h.completedSets.has(countryId);
        wrap.appendChild(this.renderHoldRow(getCityFlagEmoji(cities[0]!) ?? '', cities, isSet));
      }
    }

    if (h.airports.length > 0) {
      wrap.appendChild(this.renderHoldRow('✈', h.airports, false));
    }
    if (h.companies.length > 0) {
      wrap.appendChild(this.renderHoldRow('⚙', h.companies, false));
    }
    return wrap;
  }

  // One row per group. The leading glyph (flag / ✈ / ⚙) anchors the group;
  // each owned property is rendered as a small dot chip carrying dev/mortgage
  // info inline. Hover tooltip surfaces the property name.
  private renderHoldRow(
    glyph: string,
    items: (CityBlock | AirportBlock | CompanyBlock)[],
    isSet: boolean,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'info-menu__hold-row';

    const label = document.createElement('span');
    label.className = 'info-menu__hold-label';
    label.textContent = glyph;
    row.appendChild(label);

    const chips = document.createElement('span');
    chips.className = 'info-menu__hold-chips';
    for (const b of items) chips.appendChild(this.renderPropChip(b));
    row.appendChild(chips);

    if (isSet) {
      const star = document.createElement('span');
      star.className = 'info-menu__hold-set';
      star.textContent = '★';
      star.title = 'Complete monopoly';
      row.appendChild(star);
    }
    return row;
  }

  private renderPropChip(
    b: CityBlock | AirportBlock | CompanyBlock,
  ): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'info-menu__prop-chip';

    let body = '';
    let extraTitle = '';
    if (b.isMortgaged) {
      chip.classList.add('info-menu__prop-chip--mortgaged');
      extraTitle = ' (mortgaged)';
    } else if (b.type === 'city') {
      if (b.level === 5) {
        chip.classList.add('info-menu__prop-chip--hotel');
        body = '★';
        extraTitle = ' (hotel)';
      } else if (b.level >= 1 && b.level <= 4) {
        chip.classList.add('info-menu__prop-chip--houses');
        body = String(b.level);
        extraTitle = ` (${b.level} house${b.level === 1 ? '' : 's'})`;
      }
    }
    chip.textContent = body;
    chip.title = `${b.name}${extraTitle}`;
    return chip;
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

}
