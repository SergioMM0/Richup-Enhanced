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
  readonly label = 'Finances';

  private chipsEl: HTMLDivElement;
  private chips = new Map<string, ChipEntry>();
  private activePlayerId: string | null = null;
  private pinnedPlayerId: string | null = null;
  private context: ViewContext | null = null;
  // Per-player lap tracking. The host doesn't expose a "passed Go" counter,
  // so we infer laps from position deltas across state pushes: a position
  // wrap (new < prev) means the player crossed Go. The go-to-prison teleport
  // (prev=goToPrisonBlockIndex → new=prisonBlockIndex) is excluded; other
  // teleports (surprise/bonus cards moving you backward) may still produce
  // false positives — best-effort heuristic.
  private prevPositions = new Map<string, number>();
  private laps = new Map<string, number>();

  constructor() {
    this.chipsEl = document.createElement('div');
    this.chipsEl.className = 'info-menu__chips';
    this.chipsEl.setAttribute('role', 'tablist');
  }

  attach(context: ViewContext): void {
    this.context = context;
  }

  observeState(state: RootStoreState | null): void {
    const inner = state?.state;
    if (!inner) return;
    // Lobby positions are all 0; only count laps once a game is underway.
    if (inner.phase !== 'playing' && inner.phase !== 'ended') return;
    const goToPrison = inner.boardConfig?.goToPrisonBlockIndex ?? 30;
    const prison = inner.boardConfig?.prisonBlockIndex ?? 10;
    for (const p of inner.participants) {
      if (p.bankruptedAt !== null) continue;
      const prev = this.prevPositions.get(p.id);
      this.prevPositions.set(p.id, p.position);
      if (prev === undefined || prev === p.position) continue;
      const wrapped = p.position < prev;
      const goToPrisonRedirect =
        prev === goToPrison && p.position === prison;
      if (wrapped && !goToPrisonRedirect) {
        this.laps.set(p.id, (this.laps.get(p.id) ?? 0) + 1);
      }
    }
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
    this.prevPositions.clear();
    this.laps.clear();
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
      ? 'Unpin landing prediction'
      : 'Pin landing prediction';
    btn.textContent = isPinned
      ? `\u{1F4CC} Unpin landing prediction`
      : `\u{1F4CC} Pin landing prediction`;
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
    const turn = stats?.turnsCount ?? 0;
    const laps = this.laps.get(participant.id) ?? 0;

    section.appendChild(this.row('Laps', String(laps)));
    section.appendChild(this.row('Prison visits', String(prison)));
    section.appendChild(this.row('Game turn', String(turn)));
    return section;
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
