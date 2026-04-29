import type { RootStoreState, RUESettings } from '@shared/types';

export interface ViewContext {
  requestUpdate(): void;
}

export interface InfoMenuView {
  readonly id: string;
  readonly label: string;
  attach?(context: ViewContext): void;
  renderSubHeader?(state: RootStoreState | null): HTMLElement | null;
  renderBody(state: RootStoreState | null): HTMLElement;
  resetSession?(): void;
  destroy?(): void;
  // Optional. When provided and returning false, the view's tab is hidden
  // and renderBody is skipped. Used to gate views behind a feature flag in
  // RUESettings without removing them from the registration order.
  isEnabled?(settings: RUESettings): boolean;
}
