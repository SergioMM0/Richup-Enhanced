import type { RootStoreState, RUESettings } from '@shared/types';
import type { StateSource } from './store-relay';

// The roll button's class names are obfuscated and churn on deploys, but
// it always contains a Font Awesome dice icon — that data attribute is part
// of the icon's identity and is the stable anchor.
const DICE_ICON_SELECTOR = 'svg[data-icon="dice"]';

export class SpaceRollHandler {
  private source: StateSource;
  private settings: RUESettings;
  private boundKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);

  constructor(source: StateSource, settings: RUESettings) {
    this.source = source;
    this.settings = settings;
  }

  attach(): void {
    window.addEventListener('keydown', this.boundKeyDown, { capture: true });
  }

  detach(): void {
    window.removeEventListener('keydown', this.boundKeyDown, { capture: true });
  }

  applySettings(settings: RUESettings): void {
    this.settings = settings;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.settings.bindSpaceToRoll || !this.settings.overlaysEnabled) return;
    if (e.code !== 'Space') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.repeat) return;
    if (isTextInputTarget(e.target)) return;

    const root = this.source.getState();
    if (!isRollableTurn(root)) return;

    const button = findRollButton();
    if (!button || button.disabled) return;

    e.preventDefault();
    e.stopPropagation();
    button.click();
  }
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    'input, textarea, [contenteditable=""], [contenteditable="true"]',
  );
}

function isRollableTurn(root: RootStoreState | null): boolean {
  if (!root) return false;
  const inner = root.state;
  if (!inner) return false;
  if (inner.phase !== 'playing') return false;
  if (!inner.canPerformTurnActions) return false;
  if (inner.cubesRolledInTurn) return false;
  const me = root.selfParticipantId;
  const current = inner.participants[inner.currentPlayerIndex];
  return !!current && current.id === me;
}

function findRollButton(): HTMLButtonElement | null {
  const icon = document.querySelector(DICE_ICON_SELECTOR);
  const btn = icon?.closest('button');
  return btn instanceof HTMLButtonElement ? btn : null;
}
