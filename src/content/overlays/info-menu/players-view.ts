import type {
  Block,
  Participant,
  RootStoreState,
} from '@shared/types';
import { calcParticipantNetWorth, formatMoney } from '../../analytics/player';
import type { InfoMenuView, ViewContext } from './types';

interface ChipEntry {
  el: HTMLButtonElement;
  participant: Participant;
}

export class PlayersView implements InfoMenuView {
  readonly id = 'players';
  readonly label = 'Players';

  private chipsEl: HTMLDivElement;
  private chips = new Map<string, ChipEntry>();
  private activePlayerId: string | null = null;
  private pinnedPlayerId: string | null = null;
  private context: ViewContext | null = null;

  constructor() {
    this.chipsEl = document.createElement('div');
    this.chipsEl.className = 'info-menu__chips';
    this.chipsEl.setAttribute('role', 'tablist');
  }

  attach(context: ViewContext): void {
    this.context = context;
  }

  renderSubHeader(state: RootStoreState | null): HTMLElement | null {
    const participants = state?.state?.participants ?? [];
    const active = participants.filter((p) => p.bankruptedAt === null);
    this.ensureActivePlayer(active, state?.selfParticipantId ?? '');
    this.reconcileChips(active);
    return this.chipsEl;
  }

  resetSession(): void {
    for (const entry of this.chips.values()) entry.el.remove();
    this.chips.clear();
    this.activePlayerId = null;
    // Broadcast unpin so LandingChipsOverlay drops its copy in lockstep — its
    // own resetSession runs too, but explicit decoupled signaling is safer than
    // relying on call ordering across overlays.
    if (this.pinnedPlayerId !== null) {
      this.pinnedPlayerId = null;
      this.dispatchPin(null);
    }
  }

  renderBody(state: RootStoreState | null): HTMLElement {
    if (!state) return this.emptyMessage('Waiting for game state…');
    if (!this.activePlayerId) return this.emptyMessage('No active players');

    const participant = state.state?.participants.find(
      (p) => p.id === this.activePlayerId,
    );
    if (!participant) return this.emptyMessage('Player not found');

    const blocks = state.state?.blocks ?? [];
    const stats = state.state?.stats;

    const container = document.createElement('div');
    container.style.setProperty('--tab-color', participant.appearance);
    container.appendChild(this.renderMoneySection(participant, blocks));
    container.appendChild(this.renderStatsSection(participant, stats));
    container.appendChild(this.renderPinButton(participant));
    return container;
  }

  private renderPinButton(participant: Participant): HTMLElement {
    const isPinned = participant.id === this.pinnedPlayerId;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'info-menu__pin-toggle';
    btn.setAttribute('aria-pressed', isPinned ? 'true' : 'false');
    btn.title = isPinned
      ? 'Unpin landing chips from the board'
      : 'Pin landing chips on the board';
    btn.textContent = isPinned
      ? `\u{1F4CC} Unpin landing chips`
      : `\u{1F4CC} Pin landing chips`;
    btn.addEventListener('click', () => {
      this.togglePin(participant.id);
    });
    return btn;
  }

  private ensureActivePlayer(active: Participant[], selfId: string): void {
    const first = active[0];
    if (!first) {
      this.activePlayerId = null;
      return;
    }
    const stillActive = this.activePlayerId
      ? active.some((p) => p.id === this.activePlayerId)
      : false;
    if (stillActive) return;
    const self = active.find((p) => p.id === selfId);
    this.activePlayerId = (self ?? first).id;
  }

  private reconcileChips(active: Participant[]): void {
    const seen = new Set<string>();
    for (const p of active) {
      seen.add(p.id);
      let entry = this.chips.get(p.id);
      if (!entry) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'info-menu__chip';
        el.setAttribute('role', 'tab');
        // The hover handler in LandingChipsOverlay matches via
        // closest('[data-participant-id]'), so the chip carries the id.
        el.dataset.participantId = p.id;
        el.addEventListener('click', () => {
          this.activePlayerId = p.id;
          this.context?.requestUpdate();
        });

        this.chipsEl.appendChild(el);
        entry = { el, participant: p };
        this.chips.set(p.id, entry);
      }
      entry.participant = p;
      entry.el.style.setProperty('--tab-color', p.appearance);
      entry.el.textContent = p.name;
      entry.el.title = p.name;
      const isActive = p.id === this.activePlayerId;
      entry.el.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
    for (const id of [...this.chips.keys()]) {
      if (!seen.has(id)) {
        // If the pinned player is being removed (e.g. bankrupt), clear the pin
        // and notify LandingChipsOverlay so it stops rendering for a ghost id.
        if (this.pinnedPlayerId === id) {
          this.pinnedPlayerId = null;
          this.dispatchPin(null);
        }
        this.chips.get(id)?.el.remove();
        this.chips.delete(id);
      }
    }
  }

  private togglePin(id: string): void {
    this.pinnedPlayerId = this.pinnedPlayerId === id ? null : id;
    this.dispatchPin(this.pinnedPlayerId);
    this.context?.requestUpdate();
  }

  private dispatchPin(id: string | null): void {
    document.dispatchEvent(
      new CustomEvent('rue:pin-participant', { detail: { id } }),
    );
  }

  private renderMoneySection(
    participant: Participant,
    blocks: Block[],
  ): HTMLElement {
    const breakdown = calcParticipantNetWorth(participant, blocks);
    const section = document.createElement('section');
    section.className = 'info-menu__section';
    section.appendChild(this.sectionTitle('Money'));
    section.appendChild(this.row('Cash', formatMoney(breakdown.cash)));
    section.appendChild(this.row('Properties', formatMoney(breakdown.propertyValue)));
    if (breakdown.lockedInSets > 0) {
      section.appendChild(
        this.row('Locked in sets', formatMoney(breakdown.lockedInSets)),
      );
    }
    const divider = document.createElement('hr');
    divider.className = 'info-menu__divider';
    section.appendChild(divider);
    section.appendChild(
      this.row('Net worth', formatMoney(breakdown.total), true),
    );
    return section;
  }

  private renderStatsSection(
    participant: Participant,
    stats: RootStoreState['state']['stats'] | undefined,
  ): HTMLElement {
    const section = document.createElement('section');
    section.className = 'info-menu__section';
    section.appendChild(this.sectionTitle('Stats'));

    const prison = stats?.prisonVisits?.[participant.id] ?? 0;
    const rank = this.computeRank(stats?.leaderboard, participant.id);
    const turn = stats?.turnsCount ?? 0;
    const trades = stats?.tradesCount ?? 0;

    section.appendChild(this.row('Prison visits', String(prison)));
    section.appendChild(
      this.row('Leaderboard', rank > 0 ? `#${rank}` : '—'),
    );
    section.appendChild(this.row('Game turn', String(turn)));
    section.appendChild(this.row('Trades (game)', String(trades)));
    return section;
  }

  private computeRank(
    leaderboard: Record<string, number> | undefined,
    playerId: string,
  ): number {
    if (!leaderboard) return 0;
    const entries = Object.entries(leaderboard).sort((a, b) => b[1] - a[1]);
    const idx = entries.findIndex(([id]) => id === playerId);
    return idx >= 0 ? idx + 1 : 0;
  }

  private sectionTitle(text: string): HTMLElement {
    const h = document.createElement('h2');
    h.className = 'info-menu__section-title';
    h.textContent = text;
    return h;
  }

  private row(label: string, value: string, total = false): HTMLElement {
    const row = document.createElement('div');
    row.className = 'info-menu__row' + (total ? ' info-menu__row--total' : '');
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

  private emptyMessage(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'info-menu__empty';
    el.textContent = text;
    return el;
  }
}
