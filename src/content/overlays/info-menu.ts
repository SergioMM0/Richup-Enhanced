import type {
  Block,
  Participant,
  RootStoreState,
  RUESettings,
} from '@shared/types';
import { calcParticipantNetWorth, formatMoney } from '../analytics/player';

export const INFO_MENU_CSS = `
  .info-menu {
    position: fixed;
    right: 16px;
    bottom: 16px;
    width: 300px;
    max-height: 60vh;
    box-sizing: border-box;
    background: rgba(20, 20, 28, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    color: #f5f5f7;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 13px;
    line-height: 1.4;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
    transition: opacity 120ms linear;
  }
  .info-menu__header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .info-menu__tabs {
    flex: 1;
    display: flex;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }
  .info-menu__tabs::-webkit-scrollbar { height: 4px; }
  .info-menu__tabs::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
  }
  .info-menu__tab {
    flex: 0 0 auto;
    appearance: none;
    background: color-mix(in srgb, var(--tab-color, #888) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--tab-color, #888) 35%, transparent);
    border-bottom: 3px solid transparent;
    border-radius: 6px 6px 0 0;
    color: #f5f5f7;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    padding: 5px 9px;
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 100ms linear, border-color 100ms linear;
  }
  .info-menu__tab:hover {
    background: color-mix(in srgb, var(--tab-color, #888) 30%, transparent);
  }
  .info-menu__tab[aria-selected="true"] {
    background: color-mix(in srgb, var(--tab-color, #888) 35%, transparent);
    border-bottom-color: var(--tab-color, #888);
  }
  .info-menu__collapse {
    flex-shrink: 0;
    appearance: none;
    background: transparent;
    border: none;
    color: #f5f5f7;
    cursor: pointer;
    padding: 4px 6px;
    font-size: 14px;
    line-height: 1;
    border-radius: 4px;
    transition: background-color 100ms linear, transform 150ms ease;
  }
  .info-menu__collapse:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .info-menu--collapsed .info-menu__collapse {
    transform: rotate(180deg);
  }
  .info-menu--collapsed .info-menu__body {
    display: none;
  }
  .info-menu__body {
    flex: 1;
    overflow-y: auto;
    padding: 10px 12px 12px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }
  .info-menu__body::-webkit-scrollbar { width: 6px; }
  .info-menu__body::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
  }
  .info-menu__section {
    margin-bottom: 12px;
  }
  .info-menu__section:last-child { margin-bottom: 0; }
  .info-menu__section-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(245, 245, 247, 0.55);
    margin: 0 0 6px;
  }
  .info-menu__row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 3px 0;
    font-variant-numeric: tabular-nums;
  }
  .info-menu__row-label {
    color: rgba(245, 245, 247, 0.7);
  }
  .info-menu__row-value {
    color: #f5f5f7;
    font-weight: 600;
  }
  .info-menu__divider {
    border: none;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    margin: 6px 0;
  }
  .info-menu__row--total .info-menu__row-label {
    color: #f5f5f7;
    font-weight: 600;
  }
  .info-menu__row--total .info-menu__row-value {
    font-weight: 700;
    color: var(--tab-color, #f5f5f7);
  }
  .info-menu__empty {
    padding: 12px 0;
    text-align: center;
    color: rgba(245, 245, 247, 0.5);
    font-size: 12px;
  }
`;

interface TabEntry {
  el: HTMLButtonElement;
  participant: Participant;
}

export class InfoMenuOverlay {
  private settings: RUESettings;
  private root: HTMLDivElement;
  private header: HTMLDivElement;
  private tabsEl: HTMLDivElement;
  private collapseBtn: HTMLButtonElement;
  private body: HTMLDivElement;
  private tabs = new Map<string, TabEntry>();
  private activePlayerId: string | null = null;
  private collapsed = false;
  private lastState: RootStoreState | null = null;

  constructor(settings: RUESettings) {
    this.settings = settings;

    this.root = document.createElement('div');
    this.root.className = 'info-menu';

    this.header = document.createElement('div');
    this.header.className = 'info-menu__header';

    this.tabsEl = document.createElement('div');
    this.tabsEl.className = 'info-menu__tabs';
    this.tabsEl.setAttribute('role', 'tablist');

    this.collapseBtn = document.createElement('button');
    this.collapseBtn.type = 'button';
    this.collapseBtn.className = 'info-menu__collapse';
    this.collapseBtn.title = 'Collapse';
    this.collapseBtn.setAttribute('aria-label', 'Collapse');
    this.collapseBtn.textContent = '▾';
    this.collapseBtn.addEventListener('click', () => this.toggleCollapsed());

    this.header.appendChild(this.tabsEl);
    this.header.appendChild(this.collapseBtn);

    this.body = document.createElement('div');
    this.body.className = 'info-menu__body';

    this.root.appendChild(this.header);
    this.root.appendChild(this.body);

    this.applySettings(this.settings);
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
  }

  destroy(): void {
    this.root.remove();
    this.tabs.clear();
    this.activePlayerId = null;
    this.lastState = null;
  }

  applySettings(settings: RUESettings): void {
    this.settings = settings;
    const visible = settings.overlaysEnabled && settings.showInfoMenu;
    this.root.style.display = visible ? '' : 'none';
    this.root.style.opacity = String(settings.overlayOpacity);
  }

  update(state: RootStoreState): void {
    this.lastState = state;
    const participants = state.state?.participants ?? [];
    const active = participants.filter((p) => p.bankruptedAt === null);

    this.ensureActivePlayer(active, state.selfParticipantId);
    this.reconcileTabs(active);
    this.renderBody();
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

  private reconcileTabs(active: Participant[]): void {
    const seen = new Set<string>();
    for (const p of active) {
      seen.add(p.id);
      let entry = this.tabs.get(p.id);
      if (!entry) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'info-menu__tab';
        el.setAttribute('role', 'tab');
        el.dataset.participantId = p.id;
        el.addEventListener('click', () => {
          this.activePlayerId = p.id;
          this.update(this.lastState!);
        });
        this.tabsEl.appendChild(el);
        entry = { el, participant: p };
        this.tabs.set(p.id, entry);
      }
      entry.participant = p;
      entry.el.style.setProperty('--tab-color', p.appearance);
      entry.el.textContent = p.name;
      entry.el.title = p.name;
      const isActive = p.id === this.activePlayerId;
      entry.el.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
    for (const id of [...this.tabs.keys()]) {
      if (!seen.has(id)) {
        this.tabs.get(id)?.el.remove();
        this.tabs.delete(id);
      }
    }
  }

  private renderBody(): void {
    if (!this.lastState) {
      this.body.replaceChildren(this.emptyMessage('Waiting for game state…'));
      return;
    }
    if (!this.activePlayerId) {
      this.body.replaceChildren(this.emptyMessage('No active players'));
      return;
    }
    const participant = this.lastState.state?.participants.find(
      (p) => p.id === this.activePlayerId,
    );
    if (!participant) {
      this.body.replaceChildren(this.emptyMessage('Player not found'));
      return;
    }
    const blocks = this.lastState.state?.blocks ?? [];
    const stats = this.lastState.state?.stats;

    this.body.style.setProperty('--tab-color', participant.appearance);
    this.body.replaceChildren(
      this.renderMoneySection(participant, blocks),
      this.renderStatsSection(participant, stats),
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

  private toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    this.root.classList.toggle('info-menu--collapsed', this.collapsed);
    this.collapseBtn.title = this.collapsed ? 'Expand' : 'Collapse';
    this.collapseBtn.setAttribute(
      'aria-label',
      this.collapsed ? 'Expand' : 'Collapse',
    );
  }
}
