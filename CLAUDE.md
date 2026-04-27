# CLAUDE.md — Rich Up Enhanced (RUE)
## Chrome Extension for richup.io

This is the foundational specification for the **Rich Up Enhanced (RUE)** Chrome extension.
All agents building this project should read this document fully before writing any code.

---

## Project Summary

**Rich Up Enhanced (RUE)** is a Chrome-only extension that overlays game analytics, property
statistics, and strategic intelligence directly on top of the board tiles at richup.io.
It activates only on `https://richup.io/room/*` URLs and reads live game state from the
page's internal Zustand store via the React fiber tree. All overlays are purely visual
(non-interactive). A settings UI is accessible via the Chrome extension context menu.

---

## Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Language | TypeScript (strict) | Type safety for game state shapes |
| Bundler | Vite + `@crxjs/vite-plugin` | First-class Manifest V3 support, HMR |
| Styling | Plain CSS Modules (no framework) | Isolated styles, no conflicts with host page |
| UI Framework | **None** | Overlays are small widgets; no framework needed |
| Testing | Vitest | Fast unit tests for stat calculations |
| Manifest | Version 3 | Required for all new Chrome extensions |

Do NOT introduce React, Vue, or Svelte. The host page already uses React and a framework
conflict would cause hard-to-debug issues.

---

## Repository Structure

```
rue-extension/
├── CLAUDE.md                  ← this file
├── manifest.json              ← MV3 manifest
├── vite.config.ts
├── tsconfig.json
├── package.json
├── src/
│   ├── content/               ← injected into richup.io/room/*
│   │   ├── main-world.ts      ← runs in page's MAIN world; walks fiber, finds store
│   │   ├── index.ts           ← runs in ISOLATED world; owns chrome.* + overlays
│   │   ├── store-relay.ts     ← isolated-side StateSource fed by postMessage
│   │   ├── protocol.ts        ← typed message envelope between MAIN ↔ ISOLATED
│   │   ├── overlay-manager.ts ← creates/positions/updates overlay divs
│   │   ├── overlays/          ← individual overlay widget modules
│   │   │   ├── tile-stats.ts  ← per-tile property stats widget
│   │   │   ├── player-hud.ts  ← player money/position widget
│   │   │   └── roi-badge.ts   ← ROI/value badge per tile
│   │   └── analytics/         ← pure functions for calculations
│   │       ├── property.ts    ← ROI, rent/price ratios, break-even
│   │       ├── player.ts      ← net worth, ownership stats
│   │       └── board.ts       ← board-level heatmap, probability
│   ├── popup/                 ← extension popup (settings)
│   │   ├── popup.html
│   │   ├── popup.ts
│   │   └── popup.css
│   ├── background/
│   │   └── service-worker.ts  ← context menu registration
│   └── shared/
│       ├── types.ts           ← shared TypeScript interfaces
│       └── settings.ts        ← read/write extension settings via chrome.storage
├── public/
│   └── icons/                 ← 16, 48, 128px PNG icons
└── dist/                      ← built extension (gitignored)
```

---

## Manifest V3 Configuration

```json
{
  "manifest_version": 3,
  "name": "Rich Up Enhanced",
  "short_name": "RUE",
  "version": "0.1.0",
  "description": "Game analytics and intelligence overlay for richup.io",
  "permissions": ["storage", "contextMenus"],
  "host_permissions": ["https://richup.io/*"],
  "content_scripts": [
    {
      "matches": ["https://richup.io/room/*"],
      "js": ["src/content/main-world.ts"],
      "run_at": "document_idle",
      "world": "MAIN"
    },
    {
      "matches": ["https://richup.io/room/*"],
      "js": ["src/content/index.ts"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_icon": { "128": "public/icons/icon128.png" }
  },
  "background": {
    "service_worker": "src/background/service-worker.ts",
    "type": "module"
  },
  "icons": { "16": "public/icons/icon16.png", "48": "public/icons/icon48.png", "128": "public/icons/icon128.png" }
}
```

---

## The Host Page: richup.io Technical Notes

> ⚠️ The host page uses minified/obfuscated CSS class names (e.g. `_1KW03nqs`, `D8mtfl-S`).
> These WILL change on deploys. Never rely on these class names. Use the stable selectors below.

### Stable DOM Selectors (safe to use)

| Selector | What it identifies |
|---|---|
| `[data-testid="board"]` | The 820×820 game board container |
| `[data-board-block-index]` | Every board tile (40 total, index 0–39) |
| `[data-city-level]` | Purchasable city tiles (value = house level 0–5) |
| `[data-participant-id]` | Player card elements in the right panel |
| `[data-is-me="true"]` | The current user's player card |
| `.richup-block-top` | Tiles on the top row |
| `.richup-block-bottom` | Tiles on the bottom row |
| `.richup-block-left` | Tiles on the left column |
| `.richup-block-right` | Tiles on the right column |

The `richup-block-*` classes are semantic and stable (not obfuscated).

### Board Layout

- Board element: `[data-testid="board"]` — 820×820px, positioned at approximately (360, 106)
- 40 tiles total: 10 per side (top/right/bottom/left)
- Corner tiles are at indices 0, 10, 20, 30
- Tiles are oriented by side: top=0–9, right=10–19, bottom=20–29, left=30–39

### Tile Types (from `block.type`)

| Type | Description |
|---|---|
| `city` | Purchasable property with country grouping and 6 rent levels |
| `airport` | Purchasable airport, rent scales by number owned (1–4) |
| `company` | Purchasable utility company |
| `corner` | Go, Prison, Vacation, Go-to-Prison |
| `bonus` | Treasure chest or Surprise card |
| `tax` | Earnings Tax, Premium Tax |

---

## Accessing Live Game State

The game uses **Zustand** for state management, exposed via React Context.
The store is accessible by walking the React fiber tree from any game element.

> ⚠️ **Two-world architecture (critical):** Chrome content scripts run in an
> *isolated world* by default. The isolated world has its own JavaScript heap
> and **cannot see `__reactFiber*` expandos** that the page sets on DOM nodes.
> The fiber walk MUST run in the page's MAIN world. Use a second
> `content_scripts` entry with `"world": "MAIN"` for the bridge, and relay
> state to the isolated world via `window.postMessage`. The isolated world
> keeps `chrome.*` APIs (storage, runtime) and renders the overlays.

### The Store Bridge Pattern

The MAIN-world script locates the Zustand store once on load via the React
fiber tree, then forwards state on every change to the isolated world.
This is the single most important piece of the extension's architecture.

```typescript
// src/content/store-bridge.ts

export interface GameState {
  id: string;                        // room ID (e.g. "2ctm6")
  phase: 'lobby' | 'game' | 'ended';
  participants: Participant[];
  currentPlayerIndex: number;
  mapId: string;
  blocks: Block[];                   // 40 elements, indexed by board position
  boardConfig: BoardConfig;
  dice: [number, number];
  cubesRolledInTurn: boolean;
  canPerformTurnActions: boolean;
  doublesInARow: number;
  auction: Auction | null;
  trades: Trade[];
  bonusCards: BonusCard[];
  vacationCash: number;
  settings: GameSettings;
  hostId: string;
  winnerId: string | null;
  stats: GameStats;
}

export interface RootStoreState {
  state: GameState;
  selfParticipantId: string;
  isReady: boolean;
  isOnline: boolean;
  logs: string[];
  animation: { phase: string };
  // methods (not used by extension):
  setInitialState: Function;
  applyServerAction: Function;
  syncState: Function;
  setOnlineStatus: Function;
  addLog: Function;
  resetLogs: Function;
}

export interface ZustandStore {
  getState: () => RootStoreState;
  subscribe: (listener: (state: RootStoreState, prev: RootStoreState) => void) => () => void;
  setState: Function;
  getInitialState: Function;
}

/**
 * Walks the React fiber tree to find the Zustand store. MUST run in the page's
 * MAIN world (see two-world note above) — content-script isolated world cannot
 * see __reactFiber expandos.
 *
 * Safety rules baked in below:
 *   1. DFS via stack.pop() — never queue.shift() (O(n²) freezes the page).
 *   2. Guard `typeof memoizedProps === 'object'` — text-node fibers have a
 *      string memoizedProps, and `'value' in str` throws TypeError.
 *   3. Strict matcher: getState + setState + subscribe (loose match invokes
 *      arbitrary getState() methods on Provider values, which can hang).
 *   4. WeakSet of visited nodes; per-walk time budget (200ms) so a slow walk
 *      yields and retries on the next interval instead of locking the tab.
 *   5. Inspect Provider values, hook memoizedState chain, AND stateNode —
 *      Zustand stores can sit in any of those depending on how the page wires
 *      them. Do NOT rely on `tag === 10` alone.
 */
export function findGameStore(): ZustandStore | null {
  const root = findReactRoot();           // tries #app, #root, #__next, then walks body
  if (!root) return null;

  const stack: any[] = [];
  if (root.fiber.child) stack.push(root.fiber.child);
  if (root.fiber.sibling) stack.push(root.fiber.sibling);

  const seen = new WeakSet<object>();
  const startedAt = performance.now();
  let best: ZustandStore | null = null;
  let bestScore = -1;

  while (stack.length) {
    const node = stack.pop();
    if (!node || (typeof node === 'object' && seen.has(node))) continue;
    seen.add(node);

    if (performance.now() - startedAt > 200) break; // yield, retry on next tick

    const props = node.memoizedProps;
    if (props && typeof props === 'object' && 'value' in props) {
      const c = inspectCandidate(props.value);
      if (c && score(c) > bestScore) { best = c.store; bestScore = score(c); }
    }

    let hook = node.memoizedState;
    let steps = 0;
    while (hook && typeof hook === 'object' && steps < 50) {
      const c = inspectCandidate(hook.memoizedState);
      if (c && score(c) > bestScore) { best = c.store; bestScore = score(c); }
      hook = hook.next;
      steps++;
    }

    const c = inspectCandidate(node.stateNode);
    if (c && score(c) > bestScore) { best = c.store; bestScore = score(c); }

    if (node.child) stack.push(node.child);
    if (node.sibling) stack.push(node.sibling);
  }
  return best;
}

function inspectCandidate(value: any) {
  if (!value || typeof value !== 'object') return null;
  // All four are required — a looser check causes hangs.
  if (typeof value.getState !== 'function') return null;
  if (typeof value.subscribe !== 'function') return null;
  if (typeof value.setState !== 'function') return null;
  let root: any;
  try { root = value.getState(); } catch { return null; }
  if (!root || typeof root !== 'object') return null;
  return {
    store: value as ZustandStore,
    hasState: 'state' in root,
    hasSelfParticipantId: 'selfParticipantId' in root,
    hasIsReady: 'isReady' in root,
  };
}
function score(c: any) {
  return (c.hasSelfParticipantId ? 5 : 0) + (c.hasState ? 3 : 0) + (c.hasIsReady ? 2 : 0);
}
```

### Cross-World State Relay

The MAIN-world script subscribes to the store and forwards each state snapshot
to the isolated world. State must be JSON-serializable (no functions, DOM
nodes) before crossing — `JSON.stringify` with a function-stripping replacer
is the simplest way. Throttle pushes via `requestAnimationFrame` to avoid
flooding postMessage on rapid Zustand updates.

```typescript
// MAIN world
const serialized = JSON.parse(
  JSON.stringify(state, (_k, v) => (typeof v === 'function' ? undefined : v))
);
window.postMessage({ source: 'rue-main', type: 'state', payload: serialized }, location.origin);

// ISOLATED world
window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  if (e.data?.source !== 'rue-main') return;
  // e.data is the latest state snapshot
});
```

The isolated world exposes a `StateSource` interface (`getState()`, `subscribe()`)
that the OverlayManager consumes — it never sees the live Zustand store directly.

### Extracting Per-Tile Property Data from Fiber

Individual tile React props can be read from the tile's fiber node.
This provides richer data (e.g. `tooltipContent.props.property`) than the store alone.

```typescript
export function getTilePropertyFromFiber(tileEl: HTMLElement): Block | null {
  const fiberKey = Object.keys(tileEl).find(k => k.startsWith('__reactFiber'));
  if (!fiberKey) return null;

  let node = (tileEl as any)[fiberKey];
  let depth = 0;
  while (node && depth < 40) {
    const p = node.memoizedProps;
    if (p?.tooltipContent?.props?.property) {
      return p.tooltipContent.props.property as Block;
    }
    node = node.return;
    depth++;
  }
  return null;
}
```

---

## Full Game State Type Definitions

```typescript
// src/shared/types.ts

export interface Participant {
  id: string;
  name: string;
  appearance: string;           // hex color string
  isBot: boolean;
  position: number;             // board index 0–39
  money: number;
  bankruptedAt: string | null;
  debtTo: string | null;        // participant id they owe money to
  connectivity: 'stable' | 'unstable' | 'disconnected';
  connectivityKickAt: string | null;
  timedVotekickAt: string | null;
  votekickedAt: string | null;
}

export type BlockType = 'city' | 'airport' | 'company' | 'corner' | 'bonus' | 'tax';
export type CornerType = 'go' | 'prison' | 'vacation' | 'go_to_prison';
export type BonusType = 'treasure' | 'surprise';

export interface CityBlock {
  type: 'city';
  name: string;
  price: number;
  ownerId: string | null;
  isMortgaged: boolean;
  countryId: string;            // groups properties by color set
  rentPrices: Record<'0'|'1'|'2'|'3'|'4'|'5', number>; // 0=bare, 1-4=houses, 5=hotel
  level: number;                // current development level (0–5)
  housePrice: number;
  hotelPrice: number;
}

export interface AirportBlock {
  type: 'airport';
  name: string;
  price: number;
  ownerId: string | null;
  isMortgaged: boolean;
  rentPrices: [number, number, number, number]; // rent for 1,2,3,4 airports owned
}

export interface CompanyBlock {
  type: 'company';
  name: string;
  price: number;
  ownerId: string | null;
  isMortgaged: boolean;
}

export interface CornerBlock {
  type: 'corner';
  name: string;
  cornerType: CornerType;
}

export interface BonusBlock {
  type: 'bonus';
  name: string;
  bonusType: BonusType;
}

export interface TaxBlock {
  type: 'tax';
  name: string;
}

export type Block = CityBlock | AirportBlock | CompanyBlock | CornerBlock | BonusBlock | TaxBlock;

export interface BoardConfig {
  goReward: { land: number; pass: number };
  prisonBlockIndex: number;        // always 10
  goToPrisonBlockIndex: number;    // always 30
  vacationBlockIndex: number;      // always 20
}

export interface GameSettings {
  maxPlayers: number;
  canBotsJoin: boolean;
  isPrivate: boolean;
  onlyUsers: boolean;
  payDoubleRentWhenOwnFullSet: boolean;
  vacationCash: boolean;
  auction: boolean;
  noRentPaymentsWhileInPrison: boolean;
  mortgage: boolean;
  startingCash: number;
  evenBuild: boolean;
  shufflePlayerOrder: boolean;
}

export interface GameStats {
  turnsCount: number;
  startedAt: string | null;
  endedAt: string | null;
  doublesCount: number;
  chatMessagesCount: number;
  tradesCount: number;
  leaderboard: Record<string, number>;
  heatMap: Record<string, number>;  // tile name → landing count
  netWorths: Record<string, number>;
  prisonVisits: Record<string, number>;
  allParticipants: Participant[];
}

export interface Auction {
  blockIndex: number;
  bids: Record<string, number>;
  endAt: string;
}

export interface Trade {
  id: string;
  fromId: string;
  toId: string;
  offer: TradeOffer;
  request: TradeOffer;
}

export interface TradeOffer {
  money: number;
  blockIndexes: number[];
}

export interface RUESettings {
  overlaysEnabled: boolean;
  showROIBadge: boolean;
  showRentInfo: boolean;
  showOwnerHighlight: boolean;
  showPlayerHUD: boolean;
  overlayOpacity: number;        // 0.0–1.0
}
```

---

## Overlay System Architecture

### Core Principle

For each tile at `[data-board-block-index]`, create a positioned overlay `<div>` that:
1. Matches the tile's bounding rect using `getBoundingClientRect()`
2. Uses `position: fixed` and appropriate `z-index`
3. Uses `pointer-events: none` (purely visual, never blocks clicks)
4. Updates reactively when the Zustand store state changes

### Overlay Manager

```typescript
// src/content/overlay-manager.ts — pseudocode / architecture

class OverlayManager {
  private container: HTMLElement;     // single container div injected into body
  private overlays: Map<number, HTMLElement>;  // index → overlay div
  private store: ZustandStore;
  private unsubscribe: () => void;

  init(store: ZustandStore): void {
    // 1. Create isolated container with Shadow DOM for style isolation
    // 2. Initial render of all 40 tile overlays
    // 3. Subscribe to store changes → re-render changed tiles
    // 4. Add ResizeObserver on [data-testid="board"] for responsive repositioning
    // 5. Add scroll listener for repositioning
  }

  private renderTile(index: number): void {
    const tileEl = document.querySelector(`[data-board-block-index="${index}"]`);
    const rect = tileEl.getBoundingClientRect();
    const block = this.store.getState().state.blocks[index];
    // Position overlay to match tile
    // Render appropriate widget based on block.type
  }

  destroy(): void {
    this.unsubscribe();
    this.container.remove();
  }
}
```

### Widget Types

| Widget | Tiles | Content |
|---|---|---|
| `TileStatsWidget` | `city`, `airport`, `company` | Price, current rent, ROI%, owner color |
| `ROIBadgeWidget` | `city`, `airport`, `company` | Color-coded ROI indicator (green/yellow/red) |
| `PlayerHUDWidget` | `[data-participant-id]` | Net worth = money + property values |
| `HeatmapWidget` | All tiles | Landing frequency badge (post-game stats) |

---

## Analytics Calculations

These pure functions go in `src/content/analytics/`:

```typescript
// property.ts

/** Return on investment: bare rent / price */
export function calcROI(block: CityBlock | AirportBlock): number { ... }

/** Break-even in turns: price / expected rent given current ownership */
export function calcBreakEven(block: CityBlock, ownedInSet: number): number { ... }

/** Net worth of a participant: money + sum of owned property values */
export function calcNetWorth(participant: Participant, blocks: Block[]): number { ... }

/** Which country sets are complete (all owned by same player) */
export function findCompleteCountrySets(blocks: Block[]): Record<string, string> { ... }

/** Probability of landing on a tile per turn (simplified 2d6 distribution) */
export function landingProbability(tileIndex: number, fromIndex: number): number { ... }
```

---

## Settings

Settings are stored via `chrome.storage.sync`. The settings popup is opened
via the extension action button or the Chrome context menu.

```typescript
// src/shared/settings.ts
export const DEFAULT_SETTINGS: RUESettings = {
  overlaysEnabled: true,
  showROIBadge: true,
  showRentInfo: true,
  showOwnerHighlight: true,
  showPlayerHUD: true,
  overlayOpacity: 0.85,
};

export async function getSettings(): Promise<RUESettings> { ... }
export async function saveSettings(s: Partial<RUESettings>): Promise<void> { ... }
```

Context menu registration (background service worker):
```typescript
chrome.contextMenus.create({
  id: 'rue-settings',
  title: 'Rich Up Enhanced Settings',
  contexts: ['action']
});
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'rue-settings') {
    chrome.action.openPopup();
  }
});
```

---

## Bootstrap Flow (two content scripts)

```
document_idle fires on richup.io/room/*

MAIN world (src/content/main-world.ts):
→ findGameStore() polls every 250ms via DFS fiber walk (200ms time budget)
→ On hit: subscribe(store) → on each change, postMessage serialized state
→ Also responds to 'request-state' / 'request-diagnostic' from isolated world

ISOLATED world (src/content/index.ts):
→ store-relay.ts listens for postMessage from MAIN
→ waitForRelayReady() resolves once first state snapshot arrives
→ OverlayManager.init(stateSource)  ← consumes a StateSource interface, NOT the live store
→ Inject container div with Shadow DOM into document.body
→ Render 40 tile overlays positioned over [data-board-block-index] elements
→ Subscribe to relay for reactive updates
→ ResizeObserver on [data-testid="board"] for repositioning
→ Listen for URL changes (SPA navigation) → destroy and re-init if needed
```

---

## Important Caveats for Agents

1. **Never use obfuscated CSS class names** like `_1KW03nqs` as selectors — use `data-*`
   attributes and `richup-block-*` classes only.

2. **The fiber walk is the entry point** — there is no global `window.gameStore` or similar.
   The store must always be accessed by walking the fiber tree, **and the walk
   MUST run in the page's MAIN world**. Isolated-world content scripts cannot
   see `__reactFiber*` expandos. State crosses to isolated via `postMessage`.

   Walk safety rules (learned the hard way; ignore at your peril):
   - DFS via `stack.pop()` — never `queue.shift()` (O(n²) freezes the tab).
   - Guard `typeof memoizedProps === 'object'` before any property access.
     Text-node fibers have a string `memoizedProps` and `'value' in str` throws.
   - Match strictly on `getState + setState + subscribe` — looser matching
     invokes random `getState()` methods on Provider values that may hang.
   - Inspect Provider values, hook `memoizedState` chain, AND `stateNode`
     (don't rely on `tag === 10`).
   - 200ms per-walk time budget; retry on next interval if exceeded.

3. **The store is nested**: `store.getState()` returns a root object. The game data is in
   `store.getState().state` (the inner `state` key), not at the root level.

4. **Blocks array is indexed by board position**: `state.blocks[5]` is the tile at index 5.

5. **Use Shadow DOM** for the overlay container to prevent CSS bleed between the extension
   and the host page.

6. **The game is a SPA** — the room URL doesn't cause a full page reload between rooms.
   The content script must handle cleanup and re-initialization on room changes.

7. **Phase awareness**: The overlay should handle all three phases:
   - `lobby` — show static property info (price, rent table)
   - `game` — show live data (owner, rent level, ROI, player positions)
   - `ended` — show final stats and heatmap

8. **MutationObserver / ResizeObserver** are needed to keep overlays aligned when the
   game board re-renders or the window resizes.

---

## Development Setup

```bash
npm install
npm run dev        # Vite dev server with HMR via @crxjs/vite-plugin
npm run build      # Production build → dist/
npm run typecheck  # tsc --noEmit
npm run test       # vitest
```

Load unpacked extension from `dist/` in Chrome at `chrome://extensions`.

---

## Out of Scope (v1)

- Firefox support
- Mobile / touch
- Modifying game state (read-only extension)
- Backend API or server-side analytics
- Multiplayer comparison across sessions
