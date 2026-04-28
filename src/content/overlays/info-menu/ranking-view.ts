import type { RootStoreState } from '@shared/types';
import type {
  AirportBlock,
  CityBlock,
  CompanyBlock,
} from '@shared/types';
import {
  formatMoney,
  rankParticipants,
  type ParticipantHoldings,
  type RankedParticipant,
} from '../../analytics/player';
import { getCityFlagEmoji } from '../../analytics/flags';
import type { InfoMenuView } from './types';

export class RankingView implements InfoMenuView {
  readonly id = 'ranking';
  readonly label = 'Ranking';

  renderBody(state: RootStoreState | null): HTMLElement {
    if (!state) return this.emptyMessage('Waiting for game state…');
    const participants = state.state?.participants ?? [];
    const blocks = state.state?.blocks ?? [];
    const ranked = rankParticipants(participants, blocks);
    if (ranked.length === 0) return this.emptyMessage('No active players');

    const container = document.createElement('div');
    for (const r of ranked) container.appendChild(this.renderRankCard(r));
    return container;
  }

  private renderRankCard(r: RankedParticipant): HTMLElement {
    const card = document.createElement('section');
    card.className = 'info-menu__rank-card';
    card.style.setProperty('--tab-color', r.participant.appearance);

    card.appendChild(this.renderHeader(r));
    card.appendChild(
      this.row('Cash', formatMoney(r.breakdown.cash)),
    );
    card.appendChild(
      this.row('Properties', formatMoney(r.breakdown.propertyValue)),
    );

    const summary = this.renderHoldingsSummary(r.holdings);
    if (summary) card.appendChild(summary);

    if (r.holdings.totalProperties === 0) {
      const none = document.createElement('div');
      none.className = 'info-menu__empty';
      none.textContent = 'No properties';
      card.appendChild(none);
    } else {
      this.renderCities(card, r.holdings);
      this.renderFlatGroup(card, 'Airports', r.holdings.airports);
      this.renderFlatGroup(card, 'Companies', r.holdings.companies);
    }

    return card;
  }

  private renderHeader(r: RankedParticipant): HTMLElement {
    const header = document.createElement('div');
    header.className = 'info-menu__rank-header';

    const badge = document.createElement('span');
    badge.className = 'info-menu__rank-badge';
    badge.textContent = `#${r.rank}`;

    const name = document.createElement('span');
    name.className = 'info-menu__rank-name';
    name.textContent = r.participant.name;
    name.title = r.participant.name;

    const total = document.createElement('span');
    total.className = 'info-menu__rank-total';
    total.textContent = formatMoney(r.breakdown.total);

    header.appendChild(badge);
    header.appendChild(name);
    header.appendChild(total);
    return header;
  }

  private renderHoldingsSummary(h: ParticipantHoldings): HTMLElement | null {
    if (h.totalProperties === 0) return null;
    const parts = [`${h.totalProperties} props`];
    if (h.completedSets.size > 0) {
      parts.push(`${h.completedSets.size} ${h.completedSets.size === 1 ? 'set' : 'sets'}`);
    }
    if (h.developedCount > 0) parts.push(`${h.developedCount} developed`);
    if (h.mortgagedCount > 0) parts.push(`${h.mortgagedCount} mortgaged`);
    const el = document.createElement('div');
    el.className = 'info-menu__rank-summary';
    el.textContent = parts.join(' · ');
    return el;
  }

  private renderCities(card: HTMLElement, h: ParticipantHoldings): void {
    if (h.cities.length === 0) return;
    card.appendChild(this.groupTitle(`Cities (${h.cities.length})`));
    // Group by country so the user can scan completed sets at a glance, with
    // completed sets surfaced first.
    const countries = [...h.citiesByCountry.entries()].sort((a, b) => {
      const aDone = h.completedSets.has(a[0]) ? 0 : 1;
      const bDone = h.completedSets.has(b[0]) ? 0 : 1;
      return aDone - bDone;
    });
    for (const [countryId, cities] of countries) {
      const isSet = h.completedSets.has(countryId);
      for (const c of cities) {
        card.appendChild(this.cityRow(c, isSet));
      }
    }
  }

  private renderFlatGroup(
    card: HTMLElement,
    title: string,
    items: (AirportBlock | CompanyBlock)[],
  ): void {
    if (items.length === 0) return;
    card.appendChild(this.groupTitle(`${title} (${items.length})`));
    for (const b of items) card.appendChild(this.simpleRow(b));
  }

  private cityRow(c: CityBlock, isSet: boolean): HTMLElement {
    const flag = getCityFlagEmoji(c);
    const prefix = flag ? `${flag} ` : '';
    const suffix = isSet ? ' ★' : '';
    return this.row(
      `${prefix}${c.name}${suffix}`,
      this.cityValue(c),
      false,
      c.isMortgaged,
    );
  }

  private cityValue(c: CityBlock): string {
    if (c.isMortgaged) return 'Mortgaged';
    if (c.level === 5) return 'Hotel';
    if (c.level >= 1 && c.level <= 4) return `${c.level}H`;
    return '—';
  }

  private simpleRow(b: AirportBlock | CompanyBlock): HTMLElement {
    return this.row(b.name, b.isMortgaged ? 'Mortgaged' : '—', false, b.isMortgaged);
  }

  private groupTitle(text: string): HTMLElement {
    const h = document.createElement('div');
    h.className = 'info-menu__property-group-title';
    h.textContent = text;
    return h;
  }

  private row(
    label: string,
    value: string,
    total = false,
    mortgaged = false,
  ): HTMLElement {
    const row = document.createElement('div');
    let cls = 'info-menu__row';
    if (total) cls += ' info-menu__row--total';
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

  private emptyMessage(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'info-menu__empty';
    el.textContent = text;
    return el;
  }
}
