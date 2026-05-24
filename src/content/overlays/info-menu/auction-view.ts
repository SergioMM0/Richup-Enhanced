import type {
  AirportBlock,
  Block,
  CityBlock,
  CompanyBlock,
  Participant,
  RootStoreState,
} from '@shared/types';
import { evaluateAuction, type AuctionAdvice } from '../../analytics/auction';
import { formatMoney } from '../../analytics/player';
import { getCityFlagEmoji } from '../../analytics/flags';
import type { InfoMenuView, ViewContext } from './types';

export class AuctionView implements InfoMenuView {
  readonly id = 'auction' as const;
  readonly icon = '⚒';
  readonly label = 'Auction';

  private ctx: ViewContext | null = null;

  attach(ctx: ViewContext): void {
    this.ctx = ctx;
  }

  hasNotification(state: RootStoreState | null): boolean {
    return Boolean(state?.state?.auction);
  }

  render(state: RootStoreState | null): HTMLElement {
    const root = document.createElement('div');
    root.className = 'info-menu__view-pad';

    if (!state) return this.empty(root, 'Waiting for game state…');
    const inner = state.state;
    if (!inner) return this.empty(root, 'Waiting for game state…');
    if (!inner.auction) return this.empty(root, 'No auction in progress');

    let advice: AuctionAdvice | null;
    try {
      advice = evaluateAuction(inner, state.selfParticipantId);
    } catch (err) {
      console.error('[RUE] auction advisor crashed', err);
      return this.empty(root, 'Advisor crashed — check the console');
    }
    if (!advice) {
      return this.empty(
        root,
        'Advisor unavailable (bankrupt or disconnected)',
      );
    }

    const participants = Array.isArray(inner.participants)
      ? inner.participants
      : [];
    const density = this.ctx?.settings().densityMode ?? 'compact';

    root.appendChild(this.renderHeader(advice));
    root.appendChild(this.renderVerdict(advice));
    root.appendChild(this.renderCountdownRow(advice));
    if (advice.available) {
      root.appendChild(this.renderHighBidRow(advice, participants));
    }

    if (density === 'detailed' && advice.available) {
      root.appendChild(this.divider());
      root.appendChild(this.renderComponents(advice, participants));
    }

    return root;
  }

  private renderHeader(advice: AuctionAdvice): HTMLElement {
    const head = document.createElement('div');
    head.className = 'info-menu__opp-head';

    const badge = document.createElement('span');
    badge.className = 'info-menu__opp-badge';
    badge.textContent = '🔨';

    const name = document.createElement('span');
    name.className = 'info-menu__opp-name';
    name.textContent = this.tileLabel(advice.block);
    name.title = name.textContent;

    head.appendChild(badge);
    head.appendChild(name);

    if (advice.available) {
      const max = document.createElement('span');
      max.className = 'info-menu__opp-score';
      max.textContent = formatMoney(advice.maxBid);
      max.title = 'Recommended max bid';
      head.appendChild(max);
    }
    return head;
  }

  private renderVerdict(advice: AuctionAdvice): HTMLElement {
    const el = document.createElement('div');
    el.className = 'info-menu__opp-summary';
    if (advice.notice) {
      el.textContent = advice.notice;
      return el;
    }
    if (advice.pass) {
      el.textContent = "Pass — can't even break even on a forced mortgage";
      el.classList.add('info-menu__opp-summary--warn');
    } else if (
      advice.components.currentHighBid > 0 &&
      advice.components.currentHighBid >= advice.maxBid
    ) {
      el.textContent = 'High bid above your ceiling — let it go';
      el.classList.add('info-menu__opp-summary--warn');
    } else {
      el.textContent = `Open at ${formatMoney(advice.suggestedOpening)} · max ${formatMoney(advice.maxBid)}`;
    }
    return el;
  }

  private renderCountdownRow(advice: AuctionAdvice): HTMLElement {
    return this.row('Time left', this.formatSeconds(advice.components.secondsRemaining));
  }

  private renderHighBidRow(
    advice: AuctionAdvice,
    participants: Participant[],
  ): HTMLElement {
    const id = advice.components.currentHighBidderId;
    const amount = advice.components.currentHighBid;
    if (id === null && amount === 0) {
      return this.row('High bid', 'No bids yet');
    }
    const name = id
      ? participants.find((p) => p.id === id)?.name ?? 'opponent'
      : 'opponent';
    return this.row(`High bid (${name})`, formatMoney(amount));
  }

  private renderComponents(
    advice: AuctionAdvice,
    participants: Participant[],
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'info-menu__opp-detail';

    wrap.appendChild(
      this.row(
        `Expected rent (${advice.components.horizonRolls} rolls)`,
        formatMoney(advice.components.expectedRent),
        `≈ ${formatMoney(advice.components.expectedRentPerRoll)} per roll over ${advice.components.horizonRolls} expected opponent rolls`,
      ),
    );
    if (advice.components.setUplift > 0) {
      wrap.appendChild(
        this.row(
          'Set uplift',
          formatMoney(advice.components.setUplift),
          'Extra rent the rest of the set will collect once you complete the monopoly',
        ),
      );
    }
    if (advice.components.denialBonus > 0) {
      wrap.appendChild(
        this.row(
          'Denial value',
          formatMoney(advice.components.denialBonus),
          "Half of the rent uplift the opponent would gain by completing this set",
        ),
      );
    }
    wrap.appendChild(
      this.row(
        'Liquidity cap',
        formatMoney(advice.components.liquidityCap),
        'Hard ceiling: do not commit more than this fraction of cash to the auction',
      ),
    );
    if (advice.components.mortgageFloor > 0) {
      wrap.appendChild(
        this.row(
          'Mortgage floor',
          formatMoney(advice.components.mortgageFloor),
          'Recoverable by mortgaging the tile after winning',
        ),
      );
    }
    const threatId = advice.components.threatOpponentId;
    if (threatId) {
      const opp = participants.find((p) => p.id === threatId);
      wrap.appendChild(
        this.row(
          `Top threat (${opp?.name ?? 'opponent'})`,
          formatMoney(advice.components.threatCeiling),
          'Estimated ceiling another player can credibly bid: 40% of cash, scaled by interest',
        ),
      );
    }
    return wrap;
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

  private empty(root: HTMLElement, text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'info-menu__empty';
    el.textContent = text;
    root.appendChild(el);
    return root;
  }
}
