// Phase 1: every literal color/radius/shadow lives in a CSS variable on
// :host[data-theme="..."]. The three blocks below are the only places themes
// diverge. Densities flip via :host[data-density="..."].

const THEME_TOKENS = `
  /* Default tokens — sized for compact density. data-density="detailed"
     overrides with bigger spacing + font + chips. The default :host case
     also applies for compact so a freshly-installed extension lands here. */
  :host {
    --rue-radius-sm: 4px;
    --rue-radius-md: 6px;
    --rue-radius-lg: 12px;
    --rue-density-pad: 0.7;
    --rue-density-gap: 0.7;
    --rue-base-font-size: 12px;
    --rue-row-font-size: 11px;
    --rue-strong-font-size: 12px;
  }
  :host([data-density="detailed"]) {
    --rue-radius-md: 10px;
    --rue-density-pad: 1.4;
    --rue-density-gap: 1.4;
    --rue-base-font-size: 14px;
    --rue-row-font-size: 13px;
    --rue-strong-font-size: 14px;
  }

  /* Dark — refined frosted glass (default) */
  :host,
  :host([data-theme="dark"]) {
    --rue-bg: rgba(20, 20, 28, 0.92);
    --rue-bg-elev: rgba(255, 255, 255, 0.06);
    --rue-bg-elev-strong: rgba(255, 255, 255, 0.12);
    --rue-bg-blur: blur(8px);
    --rue-fg: #f5f5f7;
    --rue-fg-dim: rgba(245, 245, 247, 0.7);
    --rue-fg-mute: rgba(245, 245, 247, 0.5);
    --rue-accent: #f5f5f7;
    --rue-accent-soft: rgba(255, 255, 255, 0.16);
    --rue-border: rgba(255, 255, 255, 0.08);
    --rue-border-strong: rgba(255, 255, 255, 0.16);
    --rue-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
    --rue-shadow-chip: 0 2px 8px rgba(0, 0, 0, 0.7);
    --rue-money: #f5f5f7;
    --rue-rent: #ffd27a;
    --rue-warn: #ffb0b0;
    --rue-danger: #4a1f1f;
    --rue-uncertain: #cfd8e3;
    --rue-chip-bg: #0f121c;
    --rue-scroll: rgba(255, 255, 255, 0.2);
    --rue-focus: rgba(120, 170, 255, 0.85);
  }

  /* Light — warm paper, soft shadows */
  :host([data-theme="light"]) {
    --rue-bg: rgba(252, 250, 245, 0.96);
    --rue-bg-elev: rgba(0, 0, 0, 0.04);
    --rue-bg-elev-strong: rgba(0, 0, 0, 0.08);
    --rue-bg-blur: blur(8px);
    --rue-fg: #1d1d22;
    --rue-fg-dim: rgba(29, 29, 34, 0.7);
    --rue-fg-mute: rgba(29, 29, 34, 0.5);
    --rue-accent: #1d1d22;
    --rue-accent-soft: rgba(0, 0, 0, 0.08);
    --rue-border: rgba(0, 0, 0, 0.1);
    --rue-border-strong: rgba(0, 0, 0, 0.18);
    --rue-shadow: 0 6px 24px rgba(60, 50, 30, 0.18);
    --rue-shadow-chip: 0 2px 10px rgba(60, 50, 30, 0.28);
    --rue-money: #1d1d22;
    --rue-rent: #b86b00;
    --rue-warn: #b13a3a;
    --rue-danger: #f1d3d3;
    --rue-uncertain: #5b6470;
    --rue-chip-bg: #fffdf6;
    --rue-scroll: rgba(0, 0, 0, 0.2);
    --rue-focus: rgba(40, 100, 220, 0.6);
  }

  /* High-contrast — AA-compliant, no glass effects */
  :host([data-theme="high-contrast"]) {
    --rue-bg: #000;
    --rue-bg-elev: #1a1a1a;
    --rue-bg-elev-strong: #2a2a2a;
    --rue-bg-blur: none;
    --rue-fg: #fff;
    --rue-fg-dim: #fff;
    --rue-fg-mute: #d6d6d6;
    --rue-accent: #ffe600;
    --rue-accent-soft: rgba(255, 230, 0, 0.22);
    --rue-border: #fff;
    --rue-border-strong: #ffe600;
    --rue-shadow: none;
    --rue-shadow-chip: 0 0 0 1px #fff;
    --rue-money: #fff;
    --rue-rent: #ffe600;
    --rue-warn: #ff8c8c;
    --rue-danger: #5a0000;
    --rue-uncertain: #ffe600;
    --rue-chip-bg: #000;
    --rue-scroll: #fff;
    --rue-focus: #ffe600;
  }
`;

export const INFO_MENU_CSS = `
  ${THEME_TOKENS}

  .info-menu {
    position: fixed;
    /* left/top/width/height applied inline by the shell so they can be
       persisted and restored across sessions. */
    box-sizing: border-box;
    min-width: 240px;
    min-height: 160px;
    max-width: calc(100vw - 16px);
    max-height: calc(100vh - 16px);
    background: var(--rue-bg);
    border: 1px solid var(--rue-border);
    border-radius: var(--rue-radius-lg);
    backdrop-filter: var(--rue-bg-blur);
    -webkit-backdrop-filter: var(--rue-bg-blur);
    color: var(--rue-fg);
    /* 'Twemoji Country Flags' is paired with a unicode-range that targets only
       regional-indicator codepoints, so it only kicks in for flag glyphs and
       regular text still renders in the system font stack. */
    font-family: 'Twemoji Country Flags', ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: var(--rue-base-font-size);
    line-height: 1.4;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    overflow: hidden; /* required for resize: both */
    resize: both;
    box-shadow: var(--rue-shadow);
    transition: opacity 120ms linear;
  }
  .info-menu--dragging {
    user-select: none;
    cursor: grabbing;
  }
  .info-menu__header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: calc(6px * var(--rue-density-pad)) calc(8px * var(--rue-density-pad));
    border-bottom: 1px solid var(--rue-border);
    cursor: grab;
  }
  .info-menu--dragging .info-menu__header {
    cursor: grabbing;
  }
  .info-menu__drag-handle {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 18px;
    color: var(--rue-fg);
    font-size: 14px;
    line-height: 1;
    opacity: 0.45;
    cursor: grab;
    user-select: none;
    transition: opacity 100ms linear;
  }
  .info-menu__drag-handle:hover {
    opacity: 0.85;
  }
  .info-menu--dragging .info-menu__drag-handle {
    cursor: grabbing;
    opacity: 1;
  }
  .info-menu__collapse {
    flex-shrink: 0;
    appearance: none;
    background: transparent;
    border: none;
    color: var(--rue-fg);
    cursor: pointer;
    padding: 4px 6px;
    font-size: 14px;
    line-height: 1;
    border-radius: var(--rue-radius-sm);
    transition: background-color 100ms linear, transform 150ms ease;
  }
  .info-menu__collapse:hover {
    background: var(--rue-bg-elev);
  }
  .info-menu__collapse:focus-visible {
    outline: 2px solid var(--rue-focus);
    outline-offset: 1px;
  }
  .info-menu--collapsed .info-menu__collapse {
    transform: rotate(180deg);
  }
  .info-menu--collapsed {
    /* Drop the resize affordance while collapsed — height auto-shrinks to
       the header and the saved height is restored on expand. */
    resize: none;
  }
  .info-menu--collapsed .info-menu__body {
    display: none;
  }
  /* Outer body — vertical stack of pending strip / winner ribbon / main.
     The scrolling area is .info-menu__view-body deeper in, not the body
     itself. */
  .info-menu__body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .info-menu__row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 3px 0;
    font-variant-numeric: tabular-nums;
  }
  .info-menu__row-label {
    color: var(--rue-fg-dim);
  }
  .info-menu__row-value {
    color: var(--rue-fg);
    font-weight: 600;
  }
  .info-menu__empty {
    padding: 12px 0;
    text-align: center;
    color: var(--rue-fg-mute);
    font-size: 12px;
  }
  .info-menu__rank-badge {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 26px;
    height: 22px;
    padding: 0 6px;
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    background: color-mix(in srgb, var(--tab-color, var(--rue-accent)) 28%, var(--rue-bg));
    border: 1px solid color-mix(in srgb, var(--tab-color, var(--rue-accent)) 50%, transparent);
    border-radius: var(--rue-radius-sm);
    color: var(--rue-fg);
  }
  .info-menu__property-group-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--rue-fg-mute);
    margin: 8px 0 2px;
  }
  .info-menu__row--mortgaged .info-menu__row-label,
  .info-menu__row--mortgaged .info-menu__row-value {
    opacity: 0.55;
  }

  /* ============================================================
     header, pending strip, rail, players list, banners
     ============================================================ */

  /* Main area below the pending strip — rail + active view, side by side. */
  .info-menu__main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: row;
    overflow: hidden;
  }
  .info-menu__main[hidden] { display: none; }

  /* Left rail: vertical column of icon-only tabs. */
  .info-menu__rail {
    flex: 0 0 auto;
    width: 36px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 2px;
    border-right: 1px solid var(--rue-border);
    background: var(--rue-bg-elev);
  }
  .info-menu__rail-tab {
    position: relative;
    flex: 0 0 auto;
    appearance: none;
    background: transparent;
    border: none;
    color: var(--rue-fg-dim);
    border-radius: var(--rue-radius-sm);
    height: 32px;
    width: 32px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 100ms linear, color 100ms linear;
  }
  .info-menu__rail-tab:hover {
    background: var(--rue-bg-elev-strong);
    color: var(--rue-fg);
  }
  .info-menu__rail-tab[aria-selected="true"] {
    background: var(--rue-accent-soft);
    color: var(--rue-fg);
    box-shadow: inset 2px 0 0 var(--rue-accent);
  }
  .info-menu__rail-tab:focus-visible {
    outline: 2px solid var(--rue-focus);
    outline-offset: -2px;
  }
  .info-menu__rail-icon {
    font-size: 16px;
    line-height: 1;
  }
  .info-menu__rail-dot {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--rue-rent);
    box-shadow: 0 0 0 1px var(--rue-bg-elev);
  }
  .info-menu__rail-dot[hidden] { display: none; }

  /* View body fills the remaining horizontal space. */
  .info-menu__view-body {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--rue-scroll) transparent;
  }
  .info-menu__view-body::-webkit-scrollbar { width: 6px; }
  .info-menu__view-body::-webkit-scrollbar-thumb {
    background: var(--rue-scroll);
    border-radius: 3px;
  }

  /* Slim ended-state winner ribbon (sits above rail+view, doesn't take over). */
  .info-menu__winner-ribbon {
    flex: 0 0 auto;
    padding: 6px 12px;
    text-align: center;
    font-size: 12px;
    font-weight: 700;
    color: var(--rue-fg);
    background: var(--rue-bg-elev);
    border-bottom: 1px solid var(--rue-border);
  }
  .info-menu__winner-ribbon[hidden] { display: none; }
  .info-menu__winner-ribbon--has-winner {
    color: var(--tab-color, var(--rue-money));
    border-bottom-color: var(--tab-color, var(--rue-border));
  }

  .info-menu__title {
    flex: 1;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--rue-fg);
    user-select: none;
  }
  .info-menu__status-pill {
    flex: 0 0 auto;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 2px 7px;
    border-radius: 999px;
    background: var(--rue-accent-soft);
    color: var(--rue-accent);
    border: 1px solid var(--rue-accent);
  }
  .info-menu__status-pill[hidden] { display: none; }

  /* Pending strip — auction + trade summary docked to the bottom edge of
     the panel. Border on top instead of bottom now that it's the
     bottom-most element. */
  .info-menu__pending {
    flex: 0 0 auto;
    padding: calc(8px * var(--rue-density-pad)) calc(12px * var(--rue-density-pad));
    background: var(--rue-bg-elev);
    border-top: 1px solid var(--rue-border);
    cursor: pointer;
    user-select: none;
    transition: background-color 100ms linear;
  }
  .info-menu__pending[hidden] { display: none; }
  .info-menu__pending:hover { background: var(--rue-bg-elev-strong); }
  /* Empty state — bar stays mounted so the layout doesn't reflow when
     events arrive. No content, no hover affordance; a min-height keeps
     the reserved space matching a populated single-line strip. */
  .info-menu__pending--empty,
  .info-menu__pending--empty:hover {
    background: transparent;
    cursor: default;
  }
  .info-menu__pending--empty {
    min-height: calc(var(--rue-base-font-size) * 1.4);
  }
  .info-menu__pending-lines {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .info-menu__pending-line {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--rue-fg);
  }
  .info-menu__pending-icon {
    flex: 0 0 auto;
    width: 16px;
    text-align: center;
    font-size: 13px;
  }
  .info-menu__pending-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .info-menu__pending-time {
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: var(--rue-rent);
  }
  .info-menu__pending-detail {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed var(--rue-border);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .info-menu__pending-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .info-menu__pending-block-title {
    font-size: 11px;
    font-weight: 700;
    color: var(--rue-fg);
    margin-bottom: 2px;
  }
  .info-menu__pending-trade {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--rue-border);
  }
  .info-menu__pending-trade:last-child {
    padding-bottom: 0;
    border-bottom: none;
  }
  .info-menu__pending-side {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-top: 4px;
  }
  .info-menu__row--bid {
    border-left: 3px solid var(--tab-color, var(--rue-fg-mute));
    padding-left: 6px;
  }

  /* Players list — lives inside .info-menu__view-body which owns the scroll. */
  .info-menu__player-list {
    padding: calc(8px * var(--rue-density-pad)) calc(12px * var(--rue-density-pad)) calc(12px * var(--rue-density-pad));
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .info-menu__player-row {
    border-left: 3px solid color-mix(in srgb, var(--tab-color, currentColor) 70%, transparent);
    border-radius: 0 var(--rue-radius-sm) var(--rue-radius-sm) 0;
    background: transparent;
    padding: 0;
    transition: background-color 120ms linear;
  }
  .info-menu__player-row:hover {
    background: var(--rue-bg-elev);
  }
  .info-menu__player-row--current {
    background: color-mix(in srgb, var(--tab-color, var(--rue-accent)) 10%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tab-color, var(--rue-accent)) 35%, transparent);
  }
  .info-menu__player-row--expanded {
    background: var(--rue-bg-elev);
  }
  /* Subtle monopoly indicator next to the player name — reuses the gold ★
     from the holdings rows so the signal is consistent across views. */
  .info-menu__player-row-set {
    flex: 0 0 auto;
    color: var(--rue-rent);
    font-size: 11px;
    line-height: 1;
    font-weight: 700;
    user-select: none;
  }
  .info-menu__player-row-top {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: calc(6px * var(--rue-density-pad)) calc(8px * var(--rue-density-pad));
  }
  .info-menu__player-row-name {
    flex: 1;
    font-weight: 600;
    font-size: var(--rue-row-font-size);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .info-menu__player-row-total {
    flex: 0 0 auto;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--rue-money);
    font-size: var(--rue-strong-font-size);
  }
  .info-menu__player-row-detail {
    padding: 0 calc(8px * var(--rue-density-pad)) calc(10px * var(--rue-density-pad)) 14px;
    display: flex;
    flex-direction: column;
    gap: calc(4px * var(--rue-density-gap));
  }

  /* Money line — cash + property value, inline with icons. Replaces the
     four-row Cash/Properties/Locked/Prison block. */
  .info-menu__player-money {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: center;
    gap: 4px 12px;
    font-size: var(--rue-row-font-size);
  }
  .info-menu__player-money-item {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
  }
  .info-menu__player-money-icon {
    font-size: 11px;
    opacity: 0.75;
  }
  .info-menu__player-money-val {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--rue-fg);
  }

  /* Holdings — one row per country (+ airports/companies), each with the
     glyph anchor, a strip of property chips, and a ★ if the set is complete. */
  .info-menu__player-holdings {
    margin-top: 4px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .info-menu__hold-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--rue-row-font-size);
  }
  /* Plain inline-block so the two regional-indicator codepoints inside a
     flag emoji stay in one text node and get shaped as a single grapheme.
     inline-flex broke that on Windows and the flag rendered as 'GB' / 'BR'
     letter pairs. */
  .info-menu__hold-label {
    flex: 0 0 auto;
    min-width: 18px;
    display: inline-block;
    text-align: center;
    font-size: 13px;
    line-height: 1;
    user-select: none;
  }
  .info-menu__hold-chips {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    min-width: 0;
  }
  .info-menu__hold-set {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--rue-rent);
    font-weight: 700;
  }

  /* Property chip — small filled circle in the player's color. Hotel/houses
     overlay a glyph or digit; mortgaged renders as a faded ring. */
  .info-menu__prop-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--tab-color, var(--rue-accent));
    color: var(--rue-bg);
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tab-color, var(--rue-accent)) 60%, var(--rue-bg));
  }
  .info-menu__prop-chip--houses {
    background: color-mix(in srgb, var(--tab-color, var(--rue-accent)) 90%, white);
  }
  .info-menu__prop-chip--hotel {
    background: var(--rue-rent);
    color: var(--rue-bg);
    box-shadow: inset 0 0 0 1px var(--rue-rent), 0 0 6px color-mix(in srgb, var(--rue-rent) 60%, transparent);
  }
  .info-menu__prop-chip--mortgaged {
    background: transparent;
    color: var(--rue-fg-mute);
    opacity: 0.55;
    box-shadow: inset 0 0 0 1px var(--rue-fg-mute);
  }
  .info-menu__pin-btn {
    flex: 0 0 auto;
    appearance: none;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--rue-radius-sm);
    color: var(--rue-fg-mute);
    font-size: 12px;
    line-height: 1;
    padding: 2px 4px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 100ms linear, background-color 100ms linear,
      color 100ms linear, border-color 100ms linear;
  }
  .info-menu__player-row:hover .info-menu__pin-btn,
  .info-menu__player-row--expanded .info-menu__pin-btn,
  .info-menu__pin-btn[aria-pressed="true"] {
    opacity: 1;
  }
  .info-menu__pin-btn:hover {
    background: var(--rue-bg-elev-strong);
    color: var(--rue-fg);
  }
  .info-menu__pin-btn[aria-pressed="true"] {
    color: var(--rue-fg);
    background: color-mix(in srgb, var(--tab-color, var(--rue-accent)) 35%, transparent);
    border-color: var(--tab-color, var(--rue-accent));
  }
  .info-menu__pin-btn:focus-visible {
    outline: 2px solid var(--rue-focus);
    outline-offset: 1px;
    opacity: 1;
  }

  /* Banners (lobby / ended / connecting) */
  .info-menu__banner {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px 16px;
  }
  .info-menu__banner[hidden] { display: none; }
  .info-menu__banner-inner {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    text-align: center;
    width: 100%;
  }
  .info-menu__banner-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--rue-fg);
  }
  .info-menu__banner-title--winner {
    color: var(--tab-color, var(--rue-money));
  }
  .info-menu__banner-sub {
    font-size: 11px;
    color: var(--rue-fg-mute);
  }
  .info-menu__banner-dots {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: center;
    margin-top: 4px;
  }
  .info-menu__banner-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid var(--rue-border-strong);
  }
  .info-menu__player-list--final {
    margin-top: 8px;
    width: 100%;
    gap: 4px;
  }
  .info-menu__player-list--final .info-menu__player-row {
    background: var(--rue-bg-elev);
  }

  /* ============================================================
     Per-view wrapper + opportunity/auction/history cards
     ============================================================ */

  .info-menu__view-pad {
    padding: calc(8px * var(--rue-density-pad)) calc(12px * var(--rue-density-pad)) calc(12px * var(--rue-density-pad));
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Opportunity card (Trades) + Auction header card share styling. */
  .info-menu__opp-card {
    border-left: 3px solid color-mix(in srgb, var(--tab-color, currentColor) 70%, transparent);
    border-radius: 0 var(--rue-radius-sm) var(--rue-radius-sm) 0;
    background: var(--rue-bg-elev);
    padding: 6px 8px;
    cursor: default;
  }
  .info-menu__opp-card--expanded { background: var(--rue-bg-elev-strong); }

  .info-menu__opp-head {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .info-menu__opp-badge {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 22px;
    padding: 0 5px;
    font-size: 11px;
    font-weight: 700;
    background: color-mix(in srgb, var(--tab-color, var(--rue-accent)) 25%, var(--rue-bg));
    border: 1px solid color-mix(in srgb, var(--tab-color, var(--rue-accent)) 45%, transparent);
    border-radius: var(--rue-radius-sm);
    color: var(--rue-fg);
  }
  .info-menu__opp-name {
    flex: 1;
    font-weight: 600;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .info-menu__opp-score {
    flex: 0 0 auto;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--rue-money);
    font-size: 12px;
  }
  .info-menu__opp-detail {
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .info-menu__opp-summary {
    margin-top: 6px;
    font-size: 11px;
    color: var(--rue-fg-dim);
  }
  .info-menu__opp-summary--warn { color: var(--rue-warn); }
  .info-menu__divider {
    border: none;
    border-top: 1px solid var(--rue-border);
    margin: 8px 0 6px;
  }

  /* History view filters + items */
  .info-menu__history-filters {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 4px;
  }
  .info-menu__segmented {
    display: inline-flex;
    border: 1px solid var(--rue-border-strong);
    border-radius: var(--rue-radius-sm);
    overflow: hidden;
  }
  .info-menu__segment {
    appearance: none;
    background: transparent;
    border: none;
    color: var(--rue-fg-dim);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    padding: 3px 8px;
    cursor: pointer;
    border-right: 1px solid var(--rue-border);
    transition: background-color 100ms linear, color 100ms linear;
  }
  .info-menu__segment:last-child { border-right: none; }
  .info-menu__segment:hover { background: var(--rue-bg-elev); color: var(--rue-fg); }
  .info-menu__segment[aria-pressed="true"] {
    background: var(--rue-accent-soft);
    color: var(--rue-fg);
  }
  .info-menu__segment:focus-visible {
    outline: 2px solid var(--rue-focus);
    outline-offset: -2px;
  }
  .info-menu__history-player {
    flex: 1;
    min-width: 100px;
    appearance: none;
    background: var(--rue-bg);
    color: var(--rue-fg);
    font: inherit;
    font-size: 11px;
    padding: 3px 6px;
    border: 1px solid var(--rue-border-strong);
    border-radius: var(--rue-radius-sm);
  }
  .info-menu__history-section { display: flex; flex-direction: column; gap: 4px; }
  .info-menu__history-item {
    border-left: 3px solid var(--tab-color, var(--rue-fg-mute));
    background: var(--rue-bg-elev);
    border-radius: 0 var(--rue-radius-sm) var(--rue-radius-sm) 0;
    padding: 4px 6px;
  }
  .info-menu__history-item--declined { opacity: 0.65; }
  .info-menu__history-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 12px;
  }
  .info-menu__history-badge {
    flex: 0 0 auto;
    width: 12px;
    text-align: center;
    color: var(--tab-color, var(--rue-fg-mute));
    font-weight: 700;
  }
  .info-menu__history-who {
    flex: 1;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .info-menu__history-when {
    font-size: 10px;
    color: var(--rue-fg-mute);
    font-variant-numeric: tabular-nums;
  }
  .info-menu__history-sub {
    font-size: 11px;
    color: var(--rue-fg-dim);
    margin-top: 1px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .info-menu__history-side {
    margin-top: 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  /* Past-trade entries inside the pending strip's expanded view */
  .info-menu__past-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .info-menu__past-item {
    border-left: 3px solid var(--tab-color, var(--rue-fg-mute));
    padding: 4px 6px;
    background: var(--rue-bg-elev);
    border-radius: 0 var(--rue-radius-sm) var(--rue-radius-sm) 0;
  }
  .info-menu__past-item--declined { opacity: 0.7; }
  .info-menu__past-item-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 12px;
  }
  .info-menu__past-item-badge {
    width: 12px;
    text-align: center;
    color: var(--tab-color, var(--rue-fg-mute));
    font-weight: 700;
  }
  .info-menu__past-item-who {
    flex: 1;
    font-weight: 600;
    color: var(--rue-fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .info-menu__past-item-when {
    font-size: 10px;
    color: var(--rue-fg-mute);
    font-variant-numeric: tabular-nums;
  }
  .info-menu__past-item-sub {
    font-size: 11px;
    color: var(--rue-fg-dim);
    margin-top: 1px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* No auto-fire entry animations on elements that get recreated on every
     state push (player rows, pending strip, history items) — running a
     120ms animation on each refresh made detailed-mode feel glitchy when
     state ticks faster than that. The shell coalesces renders into rAF
     instead so frame rate stays stable. */

  /* Focus rings — important on high-contrast theme. */
  .info-menu__pin-btn:focus-visible,
  .info-menu__collapse:focus-visible,
  .info-menu__player-row-top:focus-visible {
    outline: 2px solid var(--rue-focus);
    outline-offset: 1px;
  }
`;
