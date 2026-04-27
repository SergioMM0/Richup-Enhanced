import type { Participant, RootStoreState, RUESettings } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/settings';
import type { StateSource } from './store-relay';
import { calcParticipantNetWorth, formatMoney } from './analytics/player';

const CONTAINER_ID = 'rue-overlay-root';
const BOARD_SELECTOR = '[data-testid="board"]';
const HUD_GAP = 4;

const SHADOW_CSS = `
  :host { all: initial; }
  .root {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483000;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .player-hud {
    position: fixed;
    pointer-events: none;
    box-sizing: border-box;
    color: var(--rue-accent, #fff);
    font-size: 14px;
    line-height: 1;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
    transition: opacity 120ms linear;
    white-space: nowrap;
    display: flex;
    align-items: center;
  }
  .player-hud .sep { opacity: 0.6; margin: 0 4px; font-weight: 400; }
  .player-hud .total { font-weight: 700; }
`;

interface PlayerHudOverlay {
  el: HTMLDivElement;
  totalSpan: HTMLSpanElement;
}

export class OverlayManager {
  private source: StateSource;
  private settings: RUESettings;
  private host: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private rootEl: HTMLDivElement | null = null;
  private playerOverlays = new Map<string, PlayerHudOverlay>();
  private unsubscribeStore: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private rafId: number | null = null;
  private onScrollOrResize = () => this.scheduleReposition();

  constructor(source: StateSource, settings: RUESettings = DEFAULT_SETTINGS) {
    this.source = source;
    this.settings = settings;
  }

  init(): void {
    this.mountShadow();
    const initialState = this.source.getState();
    if (initialState) this.renderAllPlayerHuds(initialState);
    this.scheduleReposition();
    this.attachObservers();

    this.unsubscribeStore = this.source.subscribe((state) => {
      this.renderAllPlayerHuds(state);
      this.scheduleReposition();
    });

    queueMicrotask(() => this.logHudDiagnostic());
  }

  private logHudDiagnostic(): void {
    const state = this.source.getState();
    if (!state) return;
    const participants = state.state?.participants ?? [];
    const cards = document.querySelectorAll<HTMLElement>('[data-participant-id]');
    const report = participants.map((p) => {
      const card = document.querySelector<HTMLElement>(
        `[data-participant-id="${CSS.escape(p.id)}"]`,
      );
      const cashEl = card ? this.findCashElement(card) : null;
      return {
        id: p.id,
        name: p.name,
        money: p.money,
        cardFound: !!card,
        cardSize: card ? card.getBoundingClientRect() : null,
        cashFound: !!cashEl,
        cashText: cashEl?.textContent?.trim() ?? null,
        cashRect: cashEl ? cashEl.getBoundingClientRect() : null,
      };
    });
    console.log(
      `[RUE] HUD diagnostic: ${cards.length} cards in DOM, ${participants.length} participants in store`,
      report,
    );
  }

  destroy(): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    window.removeEventListener('scroll', this.onScrollOrResize, true);
    window.removeEventListener('resize', this.onScrollOrResize);
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.host?.remove();
    this.host = null;
    this.shadowRoot = null;
    this.rootEl = null;
    this.playerOverlays.clear();
  }

  setSettings(settings: RUESettings): void {
    this.settings = settings;
    this.applyVisibility();
  }

  private mountShadow(): void {
    const existing = document.getElementById(CONTAINER_ID);
    existing?.remove();

    const host = document.createElement('div');
    host.id = CONTAINER_ID;
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.pointerEvents = 'none';
    host.style.zIndex = '2147483000';

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = SHADOW_CSS;
    shadow.appendChild(style);

    const root = document.createElement('div');
    root.className = 'root';
    shadow.appendChild(root);

    document.body.appendChild(host);
    this.host = host;
    this.shadowRoot = shadow;
    this.rootEl = root;
  }

  private renderAllPlayerHuds(state: RootStoreState): void {
    if (!this.rootEl) return;
    const participants = state.state?.participants ?? [];
    const blocks = state.state?.blocks ?? [];
    const seen = new Set<string>();

    for (const p of participants) {
      if (p.bankruptedAt !== null) continue;
      seen.add(p.id);
      this.renderPlayerHud(p, blocks);
    }

    for (const id of [...this.playerOverlays.keys()]) {
      if (!seen.has(id)) {
        const overlay = this.playerOverlays.get(id);
        overlay?.el.remove();
        this.playerOverlays.delete(id);
      }
    }
  }

  private renderPlayerHud(participant: Participant, blocks: RootStoreState['state']['blocks']): void {
    if (!this.rootEl) return;
    let overlay = this.playerOverlays.get(participant.id);
    if (!overlay) {
      const el = document.createElement('div');
      el.className = 'player-hud';
      el.dataset.participantId = participant.id;
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '/';
      const totalSpan = document.createElement('span');
      totalSpan.className = 'total';
      el.appendChild(sep);
      el.appendChild(totalSpan);
      this.rootEl.appendChild(el);
      overlay = { el, totalSpan };
      this.playerOverlays.set(participant.id, overlay);
    }
    overlay.el.style.setProperty('--rue-accent', participant.appearance);
    const breakdown = calcParticipantNetWorth(participant, blocks);
    overlay.totalSpan.textContent = formatMoney(breakdown.total);
  }

  private findCashElement(card: HTMLElement): HTMLElement | null {
    return card.querySelector<HTMLElement>('[data-testid="player-money"]');
  }

  private applyVisibility(): void {
    const baseVisible = this.settings.overlaysEnabled;
    const opacity = String(this.settings.overlayOpacity);
    const hudVisible = baseVisible && this.settings.showPlayerHUD;
    for (const { el } of this.playerOverlays.values()) {
      el.style.display = hudVisible ? '' : 'none';
      el.style.opacity = opacity;
    }
  }

  private attachObservers(): void {
    const board = document.querySelector(BOARD_SELECTOR);
    if (board) {
      this.resizeObserver = new ResizeObserver(() => this.scheduleReposition());
      this.resizeObserver.observe(board);
    }
    this.mutationObserver = new MutationObserver(() =>
      this.scheduleReposition(),
    );
    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
    window.addEventListener('scroll', this.onScrollOrResize, true);
    window.addEventListener('resize', this.onScrollOrResize);
  }

  private scheduleReposition(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.repositionAll();
    });
  }

  private repositionAll(): void {
    this.repositionPlayerHuds();
  }

  private repositionPlayerHuds(): void {
    const hudVisible =
      this.settings.overlaysEnabled && this.settings.showPlayerHUD;
    for (const [id, overlay] of this.playerOverlays) {
      const card = document.querySelector<HTMLElement>(
        `[data-participant-id="${CSS.escape(id)}"]`,
      );
      if (!card) {
        overlay.el.style.display = 'none';
        continue;
      }
      const cashEl = this.findCashElement(card);
      if (!cashEl) {
        overlay.el.style.display = 'none';
        continue;
      }
      const rect = cashEl.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        overlay.el.style.display = 'none';
        continue;
      }
      overlay.el.style.display = hudVisible ? '' : 'none';
      overlay.el.style.left = `${rect.right + HUD_GAP}px`;
      overlay.el.style.top = `${rect.top}px`;
      overlay.el.style.height = `${rect.height}px`;
      overlay.el.style.fontSize = `${Math.max(10, Math.round(rect.height * 0.65))}px`;
    }
  }
}
