import type { Participant, RUESettings } from '@shared/types';
import { airportLandingRent, cityLandingRent } from '../analytics/property';
import { DICE_SUMS, predictLanding } from '../analytics/dice';
import { formatMoney } from '../analytics/player';
import type { StateSource } from '../store-relay';

type TileSide = 'top' | 'right' | 'bottom' | 'left' | 'corner';
// Chip footprint. The chip is meant to *replace* the host page's price label,
// so we anchor it flush against the tile's outer edge with a 1px inset. Only
// the perpendicular (short-axis) dimension matters here in TS — the chip's
// box dimensions live in CSS, since top/bottom render WxH and left/right
// flip via rotate() so the chip stands upright along the board side.
// Detailed density: 68x32; compact density (default): 56x26. These are the
// design *targets*; render() shrinks the chip uniformly when the board is
// scaled below their natural size (e.g. on small monitors). chipShort is
// resolved per-render so the anchor inset still centers correctly.
const CHIP_LONG_DETAILED = 68;
const CHIP_SHORT_DETAILED = 32;
const CHIP_LONG_COMPACT = 56;
const CHIP_SHORT_COMPACT = 26;
const CHIP_INSET = 1;
// Min visible chip dimension. Below this the text becomes illegible — better
// to clip off the edge of an absurdly small board than render unreadable dots.
const CHIP_MIN_LONG = 24;

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
  chipShort: number,
): { x: number; y: number } {
  const r = tileEl.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  switch (tileSide(tileIndex)) {
    case 'top':    return { x: cx, y: r.top + CHIP_INSET + chipShort / 2 };
    case 'bottom': return { x: cx, y: r.bottom - CHIP_INSET - chipShort / 2 };
    case 'left':   return { x: r.left + CHIP_INSET + chipShort / 2, y: cy };
    case 'right':  return { x: r.right - CHIP_INSET - chipShort / 2, y: cy };
    case 'corner': return { x: cx, y: cy };
  }
}

export const LANDING_CHIPS_CSS = `
  /* Chip dimensions key off density so the panel and the on-board chips
     flip together. Compact is the default; detailed grows them. The TS
     CHIP_SHORT_* constants mirror these numbers so the chipAnchor math
     centers the chip on the tile edge. */
  :host { --rue-chip-w: 56px; --rue-chip-h: 26px; }
  :host([data-density="detailed"]) { --rue-chip-w: 68px; --rue-chip-h: 32px; }

  .rue-landing-chips {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .rue-landing-chip {
    position: absolute;
    width: var(--rue-chip-w);
    height: var(--rue-chip-h);
    transform: translate(-50%, -50%);
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto 1fr;
    column-gap: 4px;
    row-gap: 1px;
    align-items: center;
    padding: 3px 6px;
    box-sizing: border-box;
    background: var(--rue-chip-bg);
    color: var(--rue-fg);
    border-radius: var(--rue-radius-sm);
    font-family: 'Twemoji Country Flags', ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    line-height: 1;
    pointer-events: none;
    box-shadow: var(--rue-shadow-chip);
    overflow: hidden;
    opacity: 0;
    animation: rue-chip-in 120ms ease-out forwards;
  }
  @keyframes rue-chip-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  /* Side tiles rotate the entire chip box around its anchor center. The DOM
     box stays WxH; the rendered region becomes a HxW vertical strip.
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
    background: var(--rue-chip-color, var(--rue-fg));
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
    border: 1.5px solid var(--rue-chip-color, var(--rue-fg));
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
    color: var(--rue-rent);
    text-align: center;
    letter-spacing: 0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rue-landing-chip--redirected {
    background: var(--rue-danger);
  }
  .rue-landing-chip--redirected .rue-landing-chip__rent {
    color: var(--rue-warn);
    font-size: 10px;
  }
  .rue-landing-chip--uncertain .rue-landing-chip__rent {
    color: var(--rue-uncertain);
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
  // Set by updateChipScale() once a real tile has been measured. Until then
  // we fall back to the density-mode default in the chipShort getter.
  private dynamicChipShort: number | null = null;
  private unsubscribe: (() => void) | null = null;
  private boundOver = (e: MouseEvent) => this.handleOver(e);
  private boundOut = (e: MouseEvent) => this.handleOut(e);
  private boundTrigger = (e: Event) => {
    const id = (e as CustomEvent<{ id?: string }>).detail?.id;
    if (id) this.debugTrigger(id);
  };
  private boundPin = (e: Event) => this.handlePin(e);
  private boundResize = () => this.render();

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

    // Board scales with viewport; resizing the window changes tile size which
    // changes the chip dimensions we should use. render() short-circuits on
    // lastRenderedKey, but the key includes chipShort, so a real geometry
    // change will invalidate it naturally on the next pass.
    window.addEventListener('resize', this.boundResize);

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
    window.removeEventListener('resize', this.boundResize);
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
    const prevDensity = this.settings.densityMode;
    this.settings = settings;
    if (!this.container) return;
    // The container is visible when ANY prediction path can still fire — main
    // toggle (auto-follow + pin) OR the hover path. Only when both are off do
    // we hide it. Inside render() we re-check which path is allowed for the
    // current active source.
    const visible = this.containerVisible();
    this.container.style.display = visible ? '' : 'none';
    this.container.style.opacity = String(settings.overlayOpacity);
    if (!visible) {
      // Drop the pin too — re-enabling should start clean rather than
      // surface a stale pin the user can't see the trigger for.
      this.pinnedParticipantId = null;
      this.clear();
      return;
    }
    if (!this.autoAndPinAllowed()) {
      // Main toggle just went off (or was off and the sub-option just opened
      // hover-only mode). Drop the pin so we don't stick on a stale player;
      // hover still works.
      this.pinnedParticipantId = null;
      this.lastRenderedKey = null;
      this.render();
      return;
    }
    // Density flip changes chip height, which shifts the anchor offset.
    if (settings.densityMode !== prevDensity) {
      this.lastRenderedKey = null;
      this.render();
    }
  }

  private get chipShort(): number {
    if (this.dynamicChipShort !== null) return this.dynamicChipShort;
    return this.settings.densityMode === 'compact'
      ? CHIP_SHORT_COMPACT
      : CHIP_SHORT_DETAILED;
  }

  // Measure a real board tile and shrink chips uniformly when the board has
  // been scaled below the design target (small monitors, zoomed-out views).
  // Without this, the fixed 56/68px chip width overflows narrow tiles and
  // neighboring chips overlap each other on adjacent tiles. Side tiles all
  // share dimensions, so probing any non-corner tile suffices.
  private updateChipScale(): void {
    if (!this.container) return;
    const probe = document.querySelector<HTMLElement>(
      '[data-board-block-index="1"]',
    );
    if (!probe) return;
    const rect = probe.getBoundingClientRect();
    const tileShort = Math.min(rect.width, rect.height);
    if (tileShort < 4) return;

    const defaultLong =
      this.settings.densityMode === 'compact'
        ? CHIP_LONG_COMPACT
        : CHIP_LONG_DETAILED;
    const defaultShort =
      this.settings.densityMode === 'compact'
        ? CHIP_SHORT_COMPACT
        : CHIP_SHORT_DETAILED;

    // 2px breathing room between adjacent chips on neighboring tiles.
    const maxLong = Math.max(CHIP_MIN_LONG, tileShort - 2);
    const scale = Math.min(1, maxLong / defaultLong);

    const chipW = Math.round(defaultLong * scale);
    const chipH = Math.round(defaultShort * scale);

    this.container.style.setProperty('--rue-chip-w', `${chipW}px`);
    this.container.style.setProperty('--rue-chip-h', `${chipH}px`);
    this.dynamicChipShort = chipH;
  }

  // Hover predictions get their own enable path: even with the main "Landing
  // predictions" toggle off, users can still peek by hovering a player —
  // unless they've also opted out via `disableHoverLandingChips`.
  private hoverAllowed(): boolean {
    if (!this.settings.overlaysEnabled) return false;
    if (this.settings.showLandingChips) return true;
    return !this.settings.disableHoverLandingChips;
  }

  // Auto-follow (current turn) and pin require the main toggle. They paint
  // the board persistently, so we only do it when the user has explicitly
  // opted in via the main "Landing predictions" setting.
  private autoAndPinAllowed(): boolean {
    return this.settings.overlaysEnabled && this.settings.showLandingChips;
  }

  private containerVisible(): boolean {
    return this.hoverAllowed() || this.autoAndPinAllowed();
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
    if (!this.hoverAllowed()) return;
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
    // The InfoMenu re-renders the player list on every state push via
    // replaceChildren, which detaches the row under the cursor. Chrome fires
    // mouseout on the detached node but doesn't reliably re-fire mouseover on
    // the freshly attached replacement until the cursor moves — so if we
    // cleared here, the prediction would vanish on the first state push after
    // hover and never come back. Treat detached targets as "DOM mutated under
    // a stationary cursor" rather than a real mouse-leave.
    if (!card.isConnected) return;
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
    // Auto-follow current turn is the default behavior, so a render is
    // always potentially relevant when state ticks.
    this.render();
  }

  private render(): void {
    if (!this.container) {
      debug('render: no container');
      return;
    }
    if (!this.containerVisible()) {
      debug('render: disabled');
      return;
    }

    const root = this.source.getState();
    if (!root) {
      debug('render: no state');
      this.clear();
      return;
    }

    // Auto-follow the current turn is the default behavior (hover and pin
    // still override below). Active turn only exists in 'playing' phase,
    // with no auction in progress, pointing at a non-bankrupt participant.
    let currentTurnId: string | null = null;
    if (this.autoAndPinAllowed()) {
      const s = root.state;
      if (s.phase === 'playing' && !s.auction) {
        const candidate = s.participants[s.currentPlayerIndex];
        if (candidate && candidate.bankruptedAt === null) {
          currentTurnId = candidate.id;
        }
      }
    }

    // Hover > current turn > pin. Hover survives even when the main toggle is
    // off (so the user can peek); current turn and pin are gated above.
    const hoverActive = this.hoverAllowed()
      ? this.hoveredParticipantId
      : null;
    const pinActive = this.autoAndPinAllowed()
      ? this.pinnedParticipantId
      : null;
    const activeId = hoverActive ?? currentTurnId ?? pinActive;
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

    // Resolve chip dimensions against the board's current render size before
    // we key on the result. The same player at the same position can need
    // re-layout if the board itself resized.
    this.updateChipScale();

    const key = `${participant.id}:${participant.position}:${this.chipShort}`;
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
      const { x: cx, y: cy } = chipAnchor(
        tileEl,
        prediction.tileIndex,
        this.chipShort,
      );
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
