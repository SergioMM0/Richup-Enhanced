import type {
  AirportBlock,
  Block,
  CityBlock,
  CompanyBlock,
  Participant,
  RootStoreState,
  RUESettings,
} from '@shared/types';
import {
  evaluateAuction,
  type AuctionAdvice,
} from '../../analytics/auction';
import { formatMoney } from '../../analytics/player';
import { getCityFlagEmoji } from '../../analytics/flags';
import type { InfoMenuView, ViewContext } from './types';

const TICK_INTERVAL_MS = 1000;

export class AuctionView implements InfoMenuView {
  readonly id = 'auction';
  readonly label = 'Auction';

  private ctx: ViewContext | null = null;
  private timerId: number | null = null;

  attach(ctx: ViewContext): void {
    this.ctx = ctx;
    // Single 1s tick to refresh the countdown row. The shell only re-renders
    // the active tab on each tick, so when the user is on a different tab
    // this ticks at zero visible cost (no DOM mutation). When no auction is
    // active, renderBody returns the cached empty message — also cheap.
    this.timerId = window.setInterval(() => {
      this.ctx?.requestUpdate();
    }, TICK_INTERVAL_MS);
  }

  destroy(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.ctx = null;
  }

  isEnabled(settings: RUESettings): boolean {
    return settings.showAuctionAdvisor;
  }

  renderBody(state: RootStoreState | null): HTMLElement {
    if (!state) return this.emptyMessage('Waiting for game state…');
    const inner = state.state;
    if (!inner) return this.emptyMessage('Waiting for game state…');
    if (!inner.auction) return this.emptyMessage('No auction in progress');

    // The auction object's exact shape is unverified — wrap evaluation so a
    // throw inside the analytics module surfaces a useful message instead of
    // bubbling up and leaving shell.body.replaceChildren never called (which
    // strands the body on whatever it rendered before the auction started).
    let advice: AuctionAdvice | null;
    try {
      advice = evaluateAuction(inner, state.selfParticipantId);
    } catch (err) {
      console.error('[RUE] auction advisor crashed', err, {
        auction: inner.auction,
        selfId: state.selfParticipantId,
      });
      return this.emptyMessage('Advisor crashed — check the console for details');
    }
    if (!advice) {
      return this.emptyMessage(
        'Advisor unavailable (you may be bankrupt or disconnected)',
      );
    }

    const participants = Array.isArray(inner.participants)
      ? inner.participants
      : [];

    const card = document.createElement('section');
    card.className = 'info-menu__rank-card';
    const accent = this.accentFor(advice, participants);
    card.style.setProperty('--tab-color', accent);

    card.appendChild(this.renderHeader(advice));
    if (advice.notice) card.appendChild(this.summaryLine(advice.notice));

    if (!advice.available) {
      // Property-shaped tile we can't price — already-owned-by-self or
      // somehow auctioning a non-property. Header + notice is enough.
      return card;
    }

    card.appendChild(this.bigBidRow(advice));
    card.appendChild(this.passOrTip(advice));

    card.appendChild(this.divider());

    card.appendChild(
      this.row(
        `Expected rent (${advice.components.horizonRolls} rolls)`,
        formatMoney(advice.components.expectedRent),
        `≈ ${formatMoney(advice.components.expectedRentPerRoll)} per roll, summed over ${advice.components.horizonRolls} expected opponent rolls`,
      ),
    );
    if (advice.components.setUplift > 0) {
      card.appendChild(
        this.row(
          'Set uplift',
          formatMoney(advice.components.setUplift),
          'Extra rent the rest of the set will collect once you complete the monopoly',
        ),
      );
    }
    if (advice.components.denialBonus > 0) {
      card.appendChild(
        this.row(
          'Denial value',
          formatMoney(advice.components.denialBonus),
          'Half of the rent uplift the opponent would gain by completing this set',
        ),
      );
    }
    card.appendChild(
      this.row(
        'Liquidity cap',
        formatMoney(advice.components.liquidityCap),
        'Hard ceiling: you should not commit more than this fraction of cash to the auction',
      ),
    );
    if (advice.components.mortgageFloor > 0) {
      card.appendChild(
        this.row(
          'Mortgage floor',
          formatMoney(advice.components.mortgageFloor),
          'Recoverable by mortgaging the tile immediately after winning. Sets a floor on the max bid even when expected rent is low.',
        ),
      );
    }

    const threatRow = this.threatRow(advice, participants);
    if (threatRow) card.appendChild(threatRow);

    card.appendChild(this.divider());

    const highRow = this.highBidRow(advice, participants);
    if (highRow) card.appendChild(highRow);
    card.appendChild(
      this.row('Time left', this.formatSeconds(advice.components.secondsRemaining)),
    );

    return card;
  }

  renderSubHeader(state: RootStoreState | null): HTMLElement | null {
    const auction = state?.state?.auction;
    if (!auction) return null;
    const block = state?.state?.blocks?.[auction.blockIndex];
    if (!block) return null;

    const sub = document.createElement('div');
    sub.className = 'rue-auction-subheader';
    const label = document.createElement('span');
    label.className = 'rue-auction-subheader__label';
    label.textContent = 'Auction:';
    const tile = document.createElement('span');
    tile.className = 'rue-auction-subheader__tile';
    tile.textContent = this.tileLabel(block);
    const price = document.createElement('span');
    price.className = 'rue-auction-subheader__price';
    const listPrice = (block as { price?: number }).price;
    price.textContent =
      typeof listPrice === 'number' ? `list ${formatMoney(listPrice)}` : '';
    sub.appendChild(label);
    sub.appendChild(tile);
    if (price.textContent) sub.appendChild(price);
    return sub;
  }

  // Header row — big bold name + max bid as the "total".
  private renderHeader(advice: AuctionAdvice): HTMLElement {
    const header = document.createElement('div');
    header.className = 'info-menu__rank-header';

    const badge = document.createElement('span');
    badge.className = 'info-menu__rank-badge';
    badge.textContent = '🔨';
    badge.title = 'Auction';

    const name = document.createElement('span');
    name.className = 'info-menu__rank-name';
    name.textContent = this.tileLabel(advice.block);
    name.title = name.textContent ?? '';

    const total = document.createElement('span');
    total.className = 'info-menu__rank-total';
    if (advice.available) {
      total.textContent = formatMoney(advice.maxBid);
      total.title = 'Recommended max bid';
    } else {
      total.textContent = '—';
    }

    header.appendChild(badge);
    header.appendChild(name);
    header.appendChild(total);
    return header;
  }

  private bigBidRow(advice: AuctionAdvice): HTMLElement {
    return this.row(
      'Open at',
      formatMoney(advice.suggestedOpening),
      'Suggested opening bid: low enough to leave headroom, high enough to skip pointless rounds',
    );
  }

  private passOrTip(advice: AuctionAdvice): HTMLElement {
    const el = document.createElement('div');
    el.className = 'info-menu__rank-summary';
    if (advice.pass) {
      el.textContent = "Recommend: pass — can't even break even on a forced mortgage";
      el.style.color = '#ffbcbc';
    } else if (
      advice.components.currentHighBid > 0 &&
      advice.components.currentHighBid >= advice.maxBid
    ) {
      el.textContent = 'High bid above your ceiling — let it go';
      el.style.color = '#ffbcbc';
    } else {
      el.textContent = `Bid up to ${formatMoney(advice.maxBid)}`;
    }
    return el;
  }

  private threatRow(
    advice: AuctionAdvice,
    participants: Participant[],
  ): HTMLElement | null {
    const id = advice.components.threatOpponentId;
    if (!id) return null;
    const opp = participants.find((p) => p.id === id);
    const name = opp?.name ?? 'opponent';
    return this.row(
      `Top threat (${name})`,
      formatMoney(advice.components.threatCeiling),
      'Estimated max another player can credibly bid: 40% of their cash, scaled by their interest in this specific tile (existing same-set / airport / company holdings).',
    );
  }

  private highBidRow(
    advice: AuctionAdvice,
    participants: Participant[],
  ): HTMLElement | null {
    const id = advice.components.currentHighBidderId;
    const amount = advice.components.currentHighBid;
    if (id === null && amount === 0) {
      return this.row('Current high bid', 'No bids yet');
    }
    const name = id
      ? participants.find((p) => p.id === id)?.name ?? 'opponent'
      : 'opponent';
    return this.row(
      `High bid (${name})`,
      formatMoney(amount),
      'Highest standing bid in the auction right now',
    );
  }

  private accentFor(advice: AuctionAdvice, participants: Participant[]): string {
    const id = advice.components.currentHighBidderId;
    if (id) {
      const opp = participants.find((p) => p.id === id);
      if (opp?.appearance) return opp.appearance;
    }
    return '#888';
  }

  private tileLabel(block: Block): string {
    if (block.type === 'city') return this.cityLabel(block);
    if (block.type === 'airport') return `✈ ${(block as AirportBlock).name}`;
    if (block.type === 'company') return `⚙ ${(block as CompanyBlock).name}`;
    return block.type;
  }

  private cityLabel(c: CityBlock): string {
    const flag = getCityFlagEmoji(c);
    return flag ? `${flag} ${c.name}` : c.name;
  }

  private formatSeconds(secs: number): string {
    if (secs <= 0) return '0s';
    if (secs < 60) return `${secs}s`;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  }

  private summaryLine(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'info-menu__rank-summary';
    el.textContent = text;
    return el;
  }

  private divider(): HTMLElement {
    const el = document.createElement('hr');
    el.className = 'info-menu__divider';
    return el;
  }

  private row(label: string, value: string, tooltip?: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'info-menu__row';
    const l = document.createElement('span');
    l.className = 'info-menu__row-label';
    l.textContent = label;
    l.title = tooltip ?? label;
    const v = document.createElement('span');
    v.className = 'info-menu__row-value';
    v.textContent = value;
    v.title = tooltip ?? value;
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
