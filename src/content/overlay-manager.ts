import type { RUESettings } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/settings';
import type { StateSource } from './store-relay';

const CONTAINER_ID = 'rue-overlay-root';
const TILE_COUNT = 40;
const BOARD_SELECTOR = '[data-testid="board"]';

const SHADOW_CSS = `
  :host { all: initial; }
  .root {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483000;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .tile {
    position: fixed;
    pointer-events: none;
    box-sizing: border-box;
    border: 1px dashed rgba(34, 139, 87, 0.6);
    border-radius: 4px;
    background: rgba(34, 139, 87, 0.08);
    color: #0a0a0a;
    font-size: 10px;
    line-height: 1;
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    padding: 2px 3px;
    transition: opacity 120ms linear;
  }
  .tile .badge {
    background: rgba(34, 139, 87, 0.85);
    color: #fff;
    border-radius: 3px;
    padding: 1px 3px;
    font-weight: 600;
    font-size: 9px;
  }
`;

interface TileOverlay {
  el: HTMLDivElement;
  badge: HTMLSpanElement;
}

export class OverlayManager {
  private source: StateSource;
  private settings: RUESettings;
  private host: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private rootEl: HTMLDivElement | null = null;
  private overlays = new Map<number, TileOverlay>();
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
    this.renderAllTiles();
    this.scheduleReposition();
    this.attachObservers();

    this.unsubscribeStore = this.source.subscribe(() => {
      this.renderAllTiles();
    });
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
    this.overlays.clear();
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

  private renderAllTiles(): void {
    if (!this.rootEl) return;
    for (let i = 0; i < TILE_COUNT; i++) {
      this.renderTile(i);
    }
    this.applyVisibility();
  }

  private renderTile(index: number): void {
    if (!this.rootEl) return;
    let overlay = this.overlays.get(index);
    if (!overlay) {
      const el = document.createElement('div');
      el.className = 'tile';
      el.dataset.tileIndex = String(index);
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = String(index);
      el.appendChild(badge);
      this.rootEl.appendChild(el);
      overlay = { el, badge };
      this.overlays.set(index, overlay);
    }
    overlay.badge.textContent = String(index);
  }

  private applyVisibility(): void {
    const visible = this.settings.overlaysEnabled;
    const opacity = String(this.settings.overlayOpacity);
    for (const { el } of this.overlays.values()) {
      el.style.display = visible ? '' : 'none';
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
      attributeFilter: ['data-board-block-index', 'style', 'class'],
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
    for (let i = 0; i < TILE_COUNT; i++) {
      const overlay = this.overlays.get(i);
      if (!overlay) continue;
      const el = document.querySelector<HTMLElement>(
        `[data-board-block-index="${i}"]`,
      );
      if (!el) {
        overlay.el.style.display = 'none';
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        overlay.el.style.display = 'none';
        continue;
      }
      overlay.el.style.display = this.settings.overlaysEnabled ? '' : 'none';
      overlay.el.style.left = `${rect.left}px`;
      overlay.el.style.top = `${rect.top}px`;
      overlay.el.style.width = `${rect.width}px`;
      overlay.el.style.height = `${rect.height}px`;
    }
  }
}
