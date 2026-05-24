import type { RootStoreState, RUESettings } from '@shared/types';
import type { ResolvedEntry } from '../../analytics/trade-history';

export type ViewId = 'players' | 'trades' | 'auction' | 'history';

// Lightweight handle the shell gives each view. Replaces the older interface
// that had per-view observe + sub-header methods — observation now lives on
// the shell, and the shell exposes derived state (like resolvedEntries) here.
export interface ViewContext {
  // Force the shell to re-render the active view. Used when a view's local
  // state changes (filter toggles, accordion clicks, etc.) and the shell's
  // own state-tick won't fire.
  requestUpdate(): void;
  settings(): RUESettings;
  resolvedEntries(): readonly ResolvedEntry[];
}

export interface InfoMenuView {
  readonly id: ViewId;
  // Emoji rendered in the rail. Keep to a single grapheme so the rail
  // sizing stays uniform.
  readonly icon: string;
  readonly label: string;
  attach?(ctx: ViewContext): void;
  // When true, the rail draws a small accent dot on this tab. Cheap signal
  // for "there's something here you might want to look at" — supplements
  // the Pending strip rather than replacing it.
  hasNotification?(state: RootStoreState | null): boolean;
  render(state: RootStoreState | null): HTMLElement;
  resetSession?(): void;
  destroy?(): void;
}
