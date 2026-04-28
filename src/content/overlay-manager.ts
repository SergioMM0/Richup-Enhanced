import type { RootStoreState, RUESettings } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/settings';
import type { StateSource } from './store-relay';
import { INFO_MENU_CSS, InfoMenuOverlay } from './overlays/info-menu';
import {
  LANDING_CHIPS_CSS,
  LandingChipsOverlay,
} from './overlays/landing-chips';

// Identifies a single game instance within a room. Combines room id with the
// game's startedAt timestamp so that two consecutive games in the same room
// (lobby → playing → ended → lobby → playing) yield distinct keys, while a
// single game's lifetime keeps the same key across all phase transitions.
function deriveSessionKey(state: RootStoreState | null): string | null {
  if (!state) return null;
  const inner = state.state;
  if (!inner) return null;
  const roomId = inner.id ?? '';
  const startedAt = inner.stats?.startedAt ?? '∅';
  return `${roomId}::${startedAt}`;
}

const CONTAINER_ID = 'rue-overlay-root';

// Windows' default emoji font (Segoe UI Emoji) intentionally omits country
// flag glyphs — Chrome falls back to rendering the regional-indicator letters
// as plain text. We bundle Twemoji Country Flags as a web-accessible resource
// and pull it in via @font-face so flags render the same on every platform.
// Built at runtime so chrome.runtime.getURL() resolves to the actual asset URL.
function buildShadowCss(): string {
  const flagFontUrl = chrome.runtime.getURL('public/fonts/TwemojiCountryFlags.woff2');
  return `
    @font-face {
      font-family: 'Twemoji Country Flags';
      src: url('${flagFontUrl}') format('woff2');
      font-display: swap;
      unicode-range: U+1F1E6-1F1FF;
    }
    :host { all: initial; }
    .root {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483000;
      font-family: 'Twemoji Country Flags', ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    ${INFO_MENU_CSS}
    ${LANDING_CHIPS_CSS}
  `;
}

export class OverlayManager {
  private source: StateSource;
  private settings: RUESettings;
  private host: HTMLDivElement | null = null;
  private rootEl: HTMLDivElement | null = null;
  private infoMenu: InfoMenuOverlay | null = null;
  private landingChips: LandingChipsOverlay | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private currentSessionKey: string | null = null;
  private boundVisibility = () => this.handleVisibility();

  constructor(source: StateSource, settings: RUESettings = DEFAULT_SETTINGS) {
    this.source = source;
    this.settings = settings;
  }

  init(): void {
    this.mountShadow();
    if (!this.rootEl) return;

    this.infoMenu = new InfoMenuOverlay(this.settings);
    this.infoMenu.mount(this.rootEl);

    this.landingChips = new LandingChipsOverlay(this.source, this.settings);
    this.landingChips.mount(this.rootEl);

    const initialState = this.source.getState();
    // Seed the session key from the first snapshot so the first subscribe push
    // doesn't read as a transition (null → key) and trigger a phantom reset.
    this.currentSessionKey = deriveSessionKey(initialState);
    if (initialState) this.infoMenu.update(initialState);

    this.unsubscribeStore = this.source.subscribe((state) => {
      this.checkSessionTransition(state);
      this.infoMenu?.update(state);
    });

    document.addEventListener('visibilitychange', this.boundVisibility);
  }

  destroy(): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    document.removeEventListener('visibilitychange', this.boundVisibility);
    this.infoMenu?.destroy();
    this.infoMenu = null;
    this.landingChips?.destroy();
    this.landingChips = null;
    this.host?.remove();
    this.host = null;
    this.rootEl = null;
    this.currentSessionKey = null;
  }

  private checkSessionTransition(state: RootStoreState | null): void {
    const nextKey = deriveSessionKey(state);
    if (
      this.currentSessionKey !== null &&
      nextKey !== this.currentSessionKey
    ) {
      this.resetSession();
    }
    this.currentSessionKey = nextKey;
  }

  private resetSession(): void {
    this.infoMenu?.resetSession();
    this.landingChips?.resetSession();
  }

  private handleVisibility(): void {
    if (document.visibilityState !== 'visible') return;
    // On bfcache resume / tab-foreground we may have missed state pushes. Pull
    // the latest snapshot and let the same transition check decide whether to
    // reset.
    this.checkSessionTransition(this.source.getState());
  }

  setSettings(settings: RUESettings): void {
    this.settings = settings;
    this.infoMenu?.applySettings(settings);
    this.landingChips?.applySettings(settings);
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
    style.textContent = buildShadowCss();
    shadow.appendChild(style);

    const root = document.createElement('div');
    root.className = 'root';
    shadow.appendChild(root);

    document.body.appendChild(host);
    this.host = host;
    this.rootEl = root;
  }
}
