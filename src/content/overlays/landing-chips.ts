import type {
  Block,
  BoardConfig,
  Participant,
  RUESettings,
} from '@shared/types';
import { airportLandingRent, cityLandingRent } from '../analytics/property';
import { formatMoney } from '../analytics/player';
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

interface Prediction {
  tileIndex: number;
  redirected: boolean; // landed on Go-to-Prison, redirected to prison
  uncertain: boolean;  // landed on a bonus tile; card may teleport
}

const LANDING_CHIPS_BUILD = 'v3-2026-04-27';
console.log('[RUE landing-chips] module loaded', LANDING_CHIPS_BUILD);

// Gated behind sessionStorage rather than `window.__rueDebug` because content
// scripts run in an isolated JS world — flags set on the page's `window` don't
// reach us. sessionStorage is per-origin and shared across worlds.
// Toggle from the page console: sessionStorage.setItem('rue-debug', '1')
function debug(...args: unknown[]): void {
  try {
    if (sessionStorage.getItem('rue-debug') === '1') {
      console.log('[RUE landing-chips]', ...args);
    }
  } catch {
    // sessionStorage can throw in sandboxed iframes; ignore.
  }
}

function predictLanding(
  blocks: Block[],
  boardConfig: BoardConfig | undefined,
  fromPos: number,
  sum: number,
): Prediction {
  const raw = (fromPos + sum) % BOARD_SIZE;
  const block = blocks[raw];
  if (block?.type === 'corner' && block.cornerType === 'go_to_prison') {
    const prison = boardConfig?.prisonBlockIndex ?? 10;
    return { tileIndex: prison, redirected: true, uncertain: false };
  }
  if (block?.type === 'bonus') {
    return { tileIndex: raw, redirected: false, uncertain: true };
  }
  return { tileIndex: raw, redirected: false, uncertain: false };
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
  .rue-landing-chip--has-rent {
    height: 48px;
    border-radius: 24px;
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
  .rue-landing-chip__rent {
    font-size: 9px;
    font-weight: 600;
    margin-top: 2px;
    opacity: 0.95;
    color: #ffd27a;
    display: none;
  }
  .rue-landing-chip--has-rent .rue-landing-chip__rent {
    display: block;
  }
  .rue-landing-chip--redirected {
    border-style: dashed;
    background: rgba(120, 40, 40, 0.92);
  }
  .rue-landing-chip--redirected::after {
    content: "→";
    position: absolute;
    top: -8px;
    right: -8px;
    width: 16px;
    height: 16px;
    line-height: 14px;
    text-align: center;
    background: rgba(120, 40, 40, 0.95);
    border: 1px solid var(--rue-chip-color, #ffffff);
    border-radius: 50%;
    font-size: 11px;
    font-weight: 700;
  }
  .rue-landing-chip--uncertain {
    border-style: dashed;
  }
  .rue-landing-chip--uncertain::after {
    content: "?";
    position: absolute;
    top: -8px;
    right: -8px;
    width: 16px;
    height: 16px;
    line-height: 14px;
    text-align: center;
    background: rgba(15, 18, 28, 0.95);
    border: 1px solid var(--rue-chip-color, #ffffff);
    border-radius: 50%;
    font-size: 11px;
    font-weight: 700;
  }
`;

interface Chip {
  sum: number;
  el: HTMLDivElement;
  rentEl: HTMLSpanElement;
}

export class LandingChipsOverlay {
  private source: StateSource;
  private settings: RUESettings;
  private container: HTMLDivElement | null = null;
  private hoverRoot: HTMLElement | null = null;
  private chips: Chip[] = [];
  private hoveredParticipantId: string | null = null;
  private pinnedParticipantId: string | null = null;
  private lastRenderedKey: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private boundOver = (e: MouseEvent) => this.handleOver(e);
  private boundOut = (e: MouseEvent) => this.handleOut(e);
  private boundTrigger = (e: Event) => {
    const id = (e as CustomEvent<{ id?: string }>).detail?.id;
    if (id) this.debugTrigger(id);
  };
  private boundPin = (e: Event) => this.handlePin(e);

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

      const rentEl = document.createElement('span');
      rentEl.className = 'rue-landing-chip__rent';

      el.appendChild(sumEl);
      el.appendChild(probEl);
      el.appendChild(rentEl);
      this.chips.push({ sum, el, rentEl });
    }
  }

  mount(parent: HTMLElement): void {
    this.container = document.createElement('div');
    this.container.className = 'rue-landing-chips';
    parent.appendChild(this.container);
    this.hoverRoot = parent;

    // Listen on document.body for host-page player cards, and on the shadow
    // root for our own info-menu player chips (events from inside the shadow
    // tree don't bubble out to body's listener with the original target).
    document.body.addEventListener('mouseover', this.boundOver, true);
    document.body.addEventListener('mouseout', this.boundOut, true);
    parent.addEventListener('mouseover', this.boundOver, true);
    parent.addEventListener('mouseout', this.boundOut, true);

    // Cross-world test hook: page console can fire
    //   document.dispatchEvent(new CustomEvent('rue:trigger', { detail: { id } }))
    // and we'll force a render. The DOM is shared; the JS heap isn't, which is
    // why a window-level trigger doesn't survive the world boundary.
    document.addEventListener('rue:trigger', this.boundTrigger as EventListener);

    // PlayersView (info-menu) dispatches this when the user clicks a pin
    // button on a player chip. detail.id = participant id to pin, or null
    // to unpin. A document-level event keeps the two overlays decoupled.
    document.addEventListener(
      'rue:pin-participant',
      this.boundPin as EventListener,
    );

    console.log('[RUE landing-chips] mounted, listeners attached', {
      buildId: LANDING_CHIPS_BUILD,
    });

    this.unsubscribe = this.source.subscribe(() => this.repositionIfActive());
    this.applySettings(this.settings);
  }

  destroy(): void {
    document.body.removeEventListener('mouseover', this.boundOver, true);
    document.body.removeEventListener('mouseout', this.boundOut, true);
    this.hoverRoot?.removeEventListener('mouseover', this.boundOver, true);
    this.hoverRoot?.removeEventListener('mouseout', this.boundOut, true);
    document.removeEventListener('rue:trigger', this.boundTrigger as EventListener);
    document.removeEventListener(
      'rue:pin-participant',
      this.boundPin as EventListener,
    );
    this.hoverRoot = null;
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
    if (!enabled) {
      // Drop the pin too — re-enabling should start clean rather than
      // surface a stale pin the user can't see the trigger for.
      this.pinnedParticipantId = null;
      this.clear();
    }
  }

  private isEnabled(): boolean {
    return this.settings.overlaysEnabled && this.settings.showLandingChips;
  }

  private handleOver(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    const card = target?.closest?.('[data-participant-id]') as
      | HTMLElement
      | null;
    debug('handleOver fires', {
      hasCard: !!card,
      currentTarget: e.currentTarget,
      target,
      eventPhase: e.eventPhase,
    });
    if (!this.isEnabled()) return;
    if (!card) return;
    const id = card.getAttribute('data-participant-id');
    if (!id) return;
    if (this.hoveredParticipantId === id) return;
    this.hoveredParticipantId = id;
    this.lastRenderedKey = null;
    this.render();
  }

  // Expose a direct-trigger entry point so we can test the render path
  // without relying on real or synthetic mouse events.
  debugTrigger(id: string): void {
    this.hoveredParticipantId = id;
    this.lastRenderedKey = null;
    this.render();
  }

  private handlePin(e: Event): void {
    const detail = (e as CustomEvent<{ id?: string | null }>).detail;
    const next = detail?.id ?? null;
    if (this.pinnedParticipantId === next) return;
    this.pinnedParticipantId = next;
    this.lastRenderedKey = null;
    debug('pin set', { id: next });
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
    this.lastRenderedKey = null;
    // render() falls back to the pinned id if one is set; otherwise it clears.
    this.render();
  }

  private repositionIfActive(): void {
    if (!this.hoveredParticipantId && !this.pinnedParticipantId) return;
    this.render();
  }

  private render(): void {
    if (!this.container) {
      debug('render: no container');
      return;
    }
    if (!this.isEnabled()) {
      debug('render: disabled');
      return;
    }
    // Hover takes precedence; on mouseout we fall back to the pinned id.
    const activeId = this.hoveredParticipantId ?? this.pinnedParticipantId;
    if (!activeId) {
      this.clear();
      return;
    }

    const root = this.source.getState();
    if (!root) {
      debug('render: no state');
      this.clear();
      return;
    }
    const phase = root.state.phase;
    if (phase === 'ended') {
      debug('render: game ended', phase);
      this.clear();
      return;
    }

    const participant: Participant | undefined = root.state.participants.find(
      (p) => p.id === activeId,
    );
    if (!participant || participant.bankruptedAt !== null) {
      debug('render: participant missing or bankrupt', activeId);
      // If a pin pointed at a now-gone player, drop it so we don't keep
      // skipping renders for a ghost id.
      if (this.pinnedParticipantId === activeId) this.pinnedParticipantId = null;
      this.clear();
      return;
    }

    const key = `${participant.id}:${participant.position}`;
    if (this.lastRenderedKey === key) return;
    this.lastRenderedKey = key;
    debug('render', { id: participant.id, pos: participant.position, phase });

    const color = participant.appearance || '#ffffff';
    const blocks = root.state.blocks ?? [];
    const boardConfig = root.state.boardConfig;
    const settings = root.state.settings;
    // No `inPrison` flag exists on Participant; approximate via position. This
    // also matches "just visiting" — acceptable noise for v1.
    const hoveredInPrison =
      participant.position === (boardConfig?.prisonBlockIndex ?? 10);
    const suppressRent =
      hoveredInPrison && !!settings?.noRentPaymentsWhileInPrison;

    for (const { sum, el, rentEl } of this.chips) {
      const prediction = predictLanding(
        blocks,
        boardConfig,
        participant.position,
        sum,
      );
      const tileEl = document.querySelector<HTMLElement>(
        `[data-board-block-index="${prediction.tileIndex}"]`,
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
      el.classList.toggle('rue-landing-chip--redirected', prediction.redirected);
      el.classList.toggle('rue-landing-chip--uncertain', prediction.uncertain);

      let rent: number | null = null;
      if (
        !prediction.redirected &&
        !prediction.uncertain &&
        !suppressRent &&
        settings
      ) {
        const landed = blocks[prediction.tileIndex];
        if (landed?.type === 'city') {
          rent = cityLandingRent(landed, participant.id, blocks, settings);
        } else if (landed?.type === 'airport') {
          rent = airportLandingRent(landed, participant.id, blocks);
        }
      }
      if (rent !== null) {
        rentEl.textContent = formatMoney(rent);
        el.classList.add('rue-landing-chip--has-rent');
      } else {
        rentEl.textContent = '';
        el.classList.remove('rue-landing-chip--has-rent');
      }

      if (el.parentNode !== this.container) {
        this.container.appendChild(el);
      }
    }
  }

  private clear(): void {
    for (const { el } of this.chips) {
      if (el.parentNode) el.remove();
    }
    // Invalidate so a subsequent render for the same id+position re-attaches
    // the chip DOM rather than short-circuiting via lastRenderedKey.
    this.lastRenderedKey = null;
  }
}
