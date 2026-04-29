import type { Participant, RUESettings } from '@shared/types';
import { airportLandingRent, cityLandingRent } from '../analytics/property';
import { DICE_SUMS, predictLanding } from '../analytics/dice';
import { formatMoney } from '../analytics/player';
import type { StateSource } from '../store-relay';

type TileSide = 'top' | 'right' | 'bottom' | 'left' | 'corner';
// Chip footprint. The chip is meant to *replace* the host page's price label,
// so we anchor it flush against the tile's outer edge with a 1px inset. Only
// the perpendicular (short-axis) dimension matters here in TS — the chip's
// box dimensions live in CSS, since top/bottom render 64x30 and left/right
// flip to 30x64 (vertical) so the chip stands upright along the board side.
const CHIP_SHORT = 30;
const CHIP_INSET = 1;

function tileSide(index: number): TileSide {
  if (index === 0 || index === 10 || index === 20 || index === 30) return 'corner';
  if (index < 10) return 'top';
  if (index < 20) return 'right';
  if (index < 30) return 'bottom';
  return 'left';
}

const LANDING_CHIPS_BUILD = 'v6-2026-04-28-rotate-whole-chip';
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

function chipAnchor(
  tileEl: HTMLElement,
  tileIndex: number,
): { x: number; y: number } {
  const r = tileEl.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  switch (tileSide(tileIndex)) {
    case 'top':    return { x: cx, y: r.top + CHIP_INSET + CHIP_SHORT / 2 };
    case 'bottom': return { x: cx, y: r.bottom - CHIP_INSET - CHIP_SHORT / 2 };
    case 'left':   return { x: r.left + CHIP_INSET + CHIP_SHORT / 2, y: cy };
    case 'right':  return { x: r.right - CHIP_INSET - CHIP_SHORT / 2, y: cy };
    case 'corner': return { x: cx, y: cy };
  }
}

export const LANDING_CHIPS_CSS = `
  .rue-landing-chips {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .rue-landing-chip {
    position: absolute;
    width: 64px;
    height: 30px;
    transform: translate(-50%, -50%);
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto 1fr;
    column-gap: 4px;
    row-gap: 1px;
    align-items: center;
    padding: 3px 6px;
    box-sizing: border-box;
    background: #0f121c;
    color: #fff;
    border-radius: 5px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    line-height: 1;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
    overflow: hidden;
  }
  /* Side tiles rotate the entire chip box around its anchor center. The DOM
     box stays 64x30; the rendered region becomes a 30x64 vertical strip.
     The translate(-50%, -50%) keeps the chip centered on (cx, cy); the
     subsequent rotate() spins around that same center because it's the
     default transform-origin. Inner layout (sum/price/rent grid) carries
     through the rotation unchanged, preserving the design hierarchy. */
  .rue-landing-chip--side-left {
    transform: translate(-50%, -50%) rotate(90deg);
  }
  .rue-landing-chip--side-right {
    transform: translate(-50%, -50%) rotate(-90deg);
  }
  /* Player-color accent on the tile's outer edge — tells you whose chip it is
     without the heavy full border the previous design used. */
  .rue-landing-chip::before {
    content: "";
    position: absolute;
    background: var(--rue-chip-color, #ffffff);
    pointer-events: none;
  }
  .rue-landing-chip--side-top::before {
    top: 0; left: 0; right: 0; height: 2px;
  }
  /* Bottom, left, and right all stripe the chip's pre-rotation BOTTOM edge.
     For bottom tiles that's already the outer board edge; for left/right
     tiles the rotation maps that same edge onto the screen's outer board
     perimeter (CW for left → screen-left; CCW for right → screen-right). */
  .rue-landing-chip--side-bottom::before,
  .rue-landing-chip--side-left::before,
  .rue-landing-chip--side-right::before {
    bottom: 0; left: 0; right: 0; height: 2px;
  }
  /* Corners have no clear "outer edge" to stripe — fall back to a thin frame. */
  .rue-landing-chip--side-corner {
    border: 1.5px solid var(--rue-chip-color, #ffffff);
  }
  .rue-landing-chip--side-corner::before {
    display: none;
  }
  .rue-landing-chip__sum {
    grid-area: 1 / 1;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .rue-landing-chip__price {
    grid-area: 1 / 2;
    font-size: 9px;
    opacity: 0.75;
    text-align: right;
  }
  .rue-landing-chip__rent {
    grid-area: 2 / 1 / 3 / 3;
    font-size: 11px;
    font-weight: 700;
    color: #ffd27a;
    text-align: center;
    letter-spacing: 0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rue-landing-chip--redirected {
    background: #4a1f1f;
  }
  .rue-landing-chip--redirected .rue-landing-chip__rent {
    color: #ffb0b0;
    font-size: 10px;
  }
  .rue-landing-chip--uncertain .rue-landing-chip__rent {
    color: #cfd8e3;
    font-style: italic;
    font-weight: 600;
    font-size: 10px;
  }
`;

interface Chip {
  sum: number;
  el: HTMLDivElement;
  priceEl: HTMLSpanElement;
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
  private prevAutoFollow = false;
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

      const priceEl = document.createElement('span');
      priceEl.className = 'rue-landing-chip__price';

      const rentEl = document.createElement('span');
      rentEl.className = 'rue-landing-chip__rent';

      el.appendChild(sumEl);
      el.appendChild(priceEl);
      el.appendChild(rentEl);
      this.chips.push({ sum, el, priceEl, rentEl });
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

  resetSession(): void {
    this.hoveredParticipantId = null;
    this.pinnedParticipantId = null;
    this.lastRenderedKey = null;
    this.clear();
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
    const autoFollow = settings.showLandingChipsForCurrentTurn;
    if (enabled && autoFollow !== this.prevAutoFollow) {
      this.lastRenderedKey = null;
      this.render();
    }
    this.prevAutoFollow = autoFollow;
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
    const autoFollow = this.settings.showLandingChipsForCurrentTurn;
    if (
      !this.hoveredParticipantId &&
      !this.pinnedParticipantId &&
      !autoFollow
    )
      return;
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

    const root = this.source.getState();
    if (!root) {
      debug('render: no state');
      this.clear();
      return;
    }

    let currentTurnId: string | null = null;
    if (this.settings.showLandingChipsForCurrentTurn) {
      const s = root.state;
      // Active turn only exists in 'playing' phase, with no auction in
      // progress, pointing at a non-bankrupt participant.
      if (s.phase === 'playing' && !s.auction) {
        const candidate = s.participants[s.currentPlayerIndex];
        if (candidate && candidate.bankruptedAt === null) {
          currentTurnId = candidate.id;
        }
      }
    }

    // Hover > current turn > pin.
    const activeId =
      this.hoveredParticipantId ?? currentTurnId ?? this.pinnedParticipantId;
    if (!activeId) {
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

    for (const { sum, el, priceEl, rentEl } of this.chips) {
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
      const side = tileSide(prediction.tileIndex);
      const { x: cx, y: cy } = chipAnchor(tileEl, prediction.tileIndex);
      el.style.left = `${cx}px`;
      el.style.top = `${cy}px`;
      el.style.setProperty('--rue-chip-color', color);
      // Rebuild className so we don't accumulate stale --side-* classes when a
      // chip is reused for a tile on a different side across renders.
      let cls = `rue-landing-chip rue-landing-chip--side-${side}`;
      if (prediction.redirected) cls += ' rue-landing-chip--redirected';
      if (prediction.uncertain) cls += ' rue-landing-chip--uncertain';
      el.className = cls;

      const landed = blocks[prediction.tileIndex];
      const definite = !prediction.redirected && !prediction.uncertain;

      let priceText = '';
      if (
        definite &&
        (landed?.type === 'city' ||
          landed?.type === 'airport' ||
          landed?.type === 'company')
      ) {
        priceText = formatMoney(landed.price);
      }
      priceEl.textContent = priceText;

      let rentText = '';
      if (prediction.redirected) {
        rentText = '→ JAIL';
      } else if (prediction.uncertain) {
        rentText = '? bonus';
      } else if (!suppressRent && settings) {
        let rent: number | null = null;
        if (landed?.type === 'city') {
          rent = cityLandingRent(landed, participant.id, blocks, settings);
        } else if (landed?.type === 'airport') {
          rent = airportLandingRent(landed, participant.id, blocks);
        }
        if (rent !== null) rentText = formatMoney(rent);
      }
      rentEl.textContent = rentText;

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
