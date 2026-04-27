import type { RUESettings } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/settings';
import type { StateSource } from './store-relay';
import { INFO_MENU_CSS, InfoMenuOverlay } from './overlays/info-menu';

const CONTAINER_ID = 'rue-overlay-root';

const SHADOW_CSS = `
  :host { all: initial; }
  .root {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483000;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  ${INFO_MENU_CSS}
`;

export class OverlayManager {
  private source: StateSource;
  private settings: RUESettings;
  private host: HTMLDivElement | null = null;
  private rootEl: HTMLDivElement | null = null;
  private infoMenu: InfoMenuOverlay | null = null;
  private unsubscribeStore: (() => void) | null = null;

  constructor(source: StateSource, settings: RUESettings = DEFAULT_SETTINGS) {
    this.source = source;
    this.settings = settings;
  }

  init(): void {
    this.mountShadow();
    if (!this.rootEl) return;

    this.infoMenu = new InfoMenuOverlay(this.settings);
    this.infoMenu.mount(this.rootEl);

    const initialState = this.source.getState();
    if (initialState) this.infoMenu.update(initialState);

    this.unsubscribeStore = this.source.subscribe((state) => {
      this.infoMenu?.update(state);
    });
  }

  destroy(): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.infoMenu?.destroy();
    this.infoMenu = null;
    this.host?.remove();
    this.host = null;
    this.rootEl = null;
  }

  setSettings(settings: RUESettings): void {
    this.settings = settings;
    this.infoMenu?.applySettings(settings);
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
    this.rootEl = root;
  }
}
