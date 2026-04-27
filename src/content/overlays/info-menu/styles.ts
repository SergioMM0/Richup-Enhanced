export const INFO_MENU_CSS = `
  .info-menu {
    position: fixed;
    /* left/top/width/height applied inline by the shell so they can be
       persisted and restored across sessions. */
    box-sizing: border-box;
    min-width: 240px;
    min-height: 160px;
    max-width: calc(100vw - 16px);
    max-height: calc(100vh - 16px);
    background: rgba(20, 20, 28, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    color: #f5f5f7;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 13px;
    line-height: 1.4;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    overflow: hidden; /* required for resize: both */
    resize: both;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
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
    padding: 6px 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
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
    color: #f5f5f7;
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
  .info-menu__view-tabs {
    flex: 1;
    display: flex;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }
  .info-menu__view-tabs::-webkit-scrollbar { height: 4px; }
  .info-menu__view-tabs::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
  }
  .info-menu__view-tab {
    flex: 0 0 auto;
    appearance: none;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-bottom: 2px solid transparent;
    border-radius: 6px 6px 0 0;
    color: #f5f5f7;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    padding: 5px 10px;
    cursor: pointer;
    transition: background-color 100ms linear, border-color 100ms linear;
  }
  .info-menu__view-tab:hover {
    background: rgba(255, 255, 255, 0.12);
  }
  .info-menu__view-tab[aria-selected="true"] {
    background: rgba(255, 255, 255, 0.16);
    border-bottom-color: #f5f5f7;
  }
  .info-menu__sub-header {
    flex-shrink: 0;
    padding: 6px 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .info-menu__sub-header:empty {
    display: none;
  }
  .info-menu__chips {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }
  .info-menu__chips::-webkit-scrollbar { height: 4px; }
  .info-menu__chips::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
  }
  .info-menu__chip-wrap {
    position: relative;
    flex: 0 0 auto;
    display: inline-flex;
  }
  .info-menu__chip {
    appearance: none;
    background: color-mix(in srgb, var(--tab-color, #888) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--tab-color, #888) 35%, transparent);
    border-bottom: 3px solid transparent;
    border-radius: 6px 6px 0 0;
    color: #f5f5f7;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    padding: 5px 18px 5px 9px;
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 100ms linear, border-color 100ms linear;
  }
  .info-menu__chip:hover {
    background: color-mix(in srgb, var(--tab-color, #888) 30%, transparent);
  }
  .info-menu__chip[aria-selected="true"] {
    background: color-mix(in srgb, var(--tab-color, #888) 35%, transparent);
    border-bottom-color: var(--tab-color, #888);
  }
  .info-menu__chip-pin {
    position: absolute;
    top: -2px;
    right: -2px;
    width: 18px;
    height: 18px;
    appearance: none;
    background: rgba(20, 20, 28, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 50%;
    color: #f5f5f7;
    font-size: 10px;
    line-height: 1;
    padding: 0;
    cursor: pointer;
    opacity: 0.55;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 100ms linear, background-color 100ms linear,
      border-color 100ms linear, transform 100ms linear;
  }
  .info-menu__chip-wrap:hover .info-menu__chip-pin,
  .info-menu__chip-pin:focus-visible {
    opacity: 1;
  }
  .info-menu__chip-pin:hover {
    transform: scale(1.08);
  }
  .info-menu__chip-pin[aria-pressed="true"] {
    opacity: 1;
    background: color-mix(in srgb, var(--tab-color, #888) 55%, rgba(20, 20, 28, 0.85));
    border-color: var(--tab-color, #888);
  }
  .info-menu__collapse {
    flex-shrink: 0;
    appearance: none;
    background: transparent;
    border: none;
    color: #f5f5f7;
    cursor: pointer;
    padding: 4px 6px;
    font-size: 14px;
    line-height: 1;
    border-radius: 4px;
    transition: background-color 100ms linear, transform 150ms ease;
  }
  .info-menu__collapse:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .info-menu--collapsed .info-menu__collapse {
    transform: rotate(180deg);
  }
  .info-menu--collapsed {
    /* Drop the resize affordance while collapsed — height auto-shrinks to
       the header and the saved height is restored on expand. */
    resize: none;
  }
  .info-menu--collapsed .info-menu__sub-header,
  .info-menu--collapsed .info-menu__body {
    display: none;
  }
  .info-menu__body {
    flex: 1;
    overflow-y: auto;
    padding: 10px 12px 12px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }
  .info-menu__body::-webkit-scrollbar { width: 6px; }
  .info-menu__body::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
  }
  .info-menu__section {
    margin-bottom: 12px;
  }
  .info-menu__section:last-child { margin-bottom: 0; }
  .info-menu__section-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(245, 245, 247, 0.55);
    margin: 0 0 6px;
  }
  .info-menu__row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 3px 0;
    font-variant-numeric: tabular-nums;
  }
  .info-menu__row-label {
    color: rgba(245, 245, 247, 0.7);
  }
  .info-menu__row-value {
    color: #f5f5f7;
    font-weight: 600;
  }
  .info-menu__divider {
    border: none;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    margin: 6px 0;
  }
  .info-menu__row--total .info-menu__row-label {
    color: #f5f5f7;
    font-weight: 600;
  }
  .info-menu__row--total .info-menu__row-value {
    font-weight: 700;
    color: #f5f5f7;
  }
  .info-menu__empty {
    padding: 12px 0;
    text-align: center;
    color: rgba(245, 245, 247, 0.5);
    font-size: 12px;
  }
`;
