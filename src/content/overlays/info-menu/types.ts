import type { RootStoreState } from '@shared/types';

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
}
