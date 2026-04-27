import type { Participant, RootStoreState, RUESettings } from '@shared/types';
import type { StateSource } from '../store-relay';

const BOARD_SIZE = 40;

const COMBOS_OUT_OF_36: Record<number, number> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1,
};

const DICE_SUMS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

function formatProbability(sum: number): string {
  const combos = COMBOS_OUT_OF_36[sum] ?? 0;
  const pct = (combos / 36) * 100;
  return `${pct.toFixed(1)}%`;
}

export const LANDING_CHIPS_CSS = `
  .rue-landing-chips {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .rue-landing-chip {
    position: absolute;
    width: 38px;
    height: 38px;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(15, 18, 28, 0.88);
    color: #fff;
    border: 2px solid var(--rue-chip-color, #ffffff);
    border-radius: 999px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    line-height: 1;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
  }
  .rue-landing-chip__sum {
    font-size: 13px;
    font-weight: 700;
  }
  .rue-landing-chip__prob {
    font-size: 9px;
    opacity: 0.85;
    margin-top: 2px;
  }
`;

interface Chip {
  sum: number;
  el: HTMLDivElement;
}

export class LandingChipsOverlay {
  private source: StateSource;
  private settings: RUESettings;
  private container: HTMLDivElement | null = null;
  private chips: Chip[] = [];
  private hoveredParticipantId: string | null = null;
  private lastRenderedPosition: number | null = null;
  private unsubscribe: (() => void) | null = null;
  private boundOver = (e: MouseEvent) => this.handleOver(e);
  private boundOut = (e: MouseEvent) => this.handleOut(e);

  constructor(source: StateSource, settings: RUESettings) {
    this.source = source;
    this.settings = settings;

    for (const sum of DICE_SUMS) {
      const el = document.createElement('div');
      el.className = 'rue-landing-chip';

      const sumEl = document.createElement('span');
      sumEl.className = 'rue-landing-chip__sum';
      sumEl.textContent = String(sum);

      const probEl = document.createElement('span');
      probEl.className = 'rue-landing-chip__prob';
      probEl.textContent = formatProbability(sum);

      el.appendChild(sumEl);
      el.appendChild(probEl);
      this.chips.push({ sum, el });
    }
  }

  mount(parent: HTMLElement): void {
    this.container = document.createElement('div');
    this.container.className = 'rue-landing-chips';
    parent.appendChild(this.container);

    document.body.addEventListener('mouseover', this.boundOver, true);
    document.body.addEventListener('mouseout', this.boundOut, true);

    this.unsubscribe = this.source.subscribe(() => this.repositionIfActive());
    this.applySettings(this.settings);
  }

  destroy(): void {
    document.body.removeEventListener('mouseover', this.boundOver, true);
    document.body.removeEventListener('mouseout', this.boundOut, true);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.clear();
    this.container?.remove();
    this.container = null;
  }

  applySettings(settings: RUESettings): void {
    this.settings = settings;
    if (!this.container) return;
    const enabled = settings.overlaysEnabled && settings.showLandingChips;
    this.container.style.display = enabled ? '' : 'none';
    this.container.style.opacity = String(settings.overlayOpacity);
    if (!enabled) this.clear();
  }

  private isEnabled(): boolean {
    return this.settings.overlaysEnabled && this.settings.showLandingChips;
  }

  private handleOver(e: MouseEvent): void {
    if (!this.isEnabled()) return;
    const target = e.target as HTMLElement | null;
    const card = target?.closest?.('[data-participant-id]') as
      | HTMLElement
      | null;
    if (!card) return;
    const id = card.getAttribute('data-participant-id');
    if (!id) return;
    if (this.hoveredParticipantId === id) return;
    this.hoveredParticipantId = id;
    this.lastRenderedPosition = null;
    this.render();
  }

  private handleOut(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    const card = target?.closest?.('[data-participant-id]') as
      | HTMLElement
      | null;
    if (!card) return;
    const related = e.relatedTarget as HTMLElement | null;
    if (related && card.contains(related)) return;
    // If moving directly to another player card, let mouseover swap us over.
    if (related?.closest?.('[data-participant-id]')) return;
    if (this.hoveredParticipantId === null) return;
    this.hoveredParticipantId = null;
    this.lastRenderedPosition = null;
    this.clear();
  }

  private repositionIfActive(): void {
    if (!this.hoveredParticipantId) return;
    this.render();
  }

  private render(): void {
    if (!this.container) return;
    if (!this.isEnabled()) return;
    if (!this.hoveredParticipantId) return;

    const root = this.source.getState();
    if (!root) {
      this.clear();
      return;
    }
    const phase = root.state.phase;
    if (phase !== 'game' && phase !== 'lobby') {
      this.clear();
      return;
    }

    const participant: Participant | undefined = root.state.participants.find(
      (p) => p.id === this.hoveredParticipantId,
    );
    if (!participant || participant.bankruptedAt !== null) {
      this.clear();
      return;
    }

    if (this.lastRenderedPosition === participant.position) return;
    this.lastRenderedPosition = participant.position;

    const color = participant.appearance || '#ffffff';

    for (const { sum, el } of this.chips) {
      const tileIndex = (participant.position + sum) % BOARD_SIZE;
      const tileEl = document.querySelector<HTMLElement>(
        `[data-board-block-index="${tileIndex}"]`,
      );
      if (!tileEl) {
        el.remove();
        continue;
      }
      const rect = tileEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      el.style.left = `${cx}px`;
      el.style.top = `${cy}px`;
      el.style.setProperty('--rue-chip-color', color);
      if (el.parentNode !== this.container) {
        this.container.appendChild(el);
      }
    }
  }

  private clear(): void {
    for (const { el } of this.chips) {
      if (el.parentNode) el.remove();
    }
  }
}
