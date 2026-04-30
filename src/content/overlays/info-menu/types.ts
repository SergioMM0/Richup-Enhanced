import type { RootStoreState, RUESettings } from '@shared/types';

export interface ViewContext {
  requestUpdate(): void;
}

export interface InfoMenuView {
  readonly id: string;
  readonly label: string;
  attach?(context: ViewContext): void;
  // Fires on every state push regardless of which view is active. Use for
  // background bookkeeping that must not miss updates while the user is on
  // another tab (e.g. PlayersView's lap counter watches position deltas).
  observeState?(state: RootStoreState | null): void;
  renderSubHeader?(state: RootStoreState | null): HTMLElement | null;
  renderBody(state: RootStoreState | null): HTMLElement;
  resetSession?(): void;
  destroy?(): void;
  // Optional. When provided and returning false, the view's tab is hidden
  // and renderBody is skipped. Used to gate views behind a feature flag in
  // RUESettings without removing them from the registration order.
  isEnabled?(settings: RUESettings): boolean;
}
