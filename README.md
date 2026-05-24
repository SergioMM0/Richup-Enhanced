# Rich Up Enhanced (RUE)

A Chrome extension that overlays live game analytics on top of [richup.io](https://richup.io) — the unofficial Monopoly-style browser game.

RUE reads game state directly from the page's internal Zustand store (via a React fiber walk in the page's MAIN world) and renders a non-interactive overlay UI inside a Shadow DOM. It is read-only — it never modifies game state or sends network requests.

> Not affiliated with richup.io. This is a fan-made tool.

---

## Features

- **Players panel** — draggable, resizable, collapsible side panel with per-player cash, properties, locked-in color sets, leaderboard rank, and prison visits. Pin any player to lock their landing-chip prediction onto the board.
- **Landing prediction chips** — for the hovered/pinned/current-turn player, one chip per dice sum (2–12) is rendered on the predicted landing tile, labelled with the rent that player would owe. Accounts for go-to-prison redirects, bonus-tile uncertainty, mortgages, full-set double-rent, and airport ownership counts.
- **Ranking view** — leaderboard tab inside the panel showing each player's holdings with country-flag emoji per city.
- **Live settings** — popup edits apply immediately without a page reload. Theme (dark / light / high-contrast), density mode, overlay opacity, and per-overlay toggles.
- **Geometry persistence** — info-menu position and size are remembered per device (`chrome.storage.local`).
- **Lifecycle aware** — handles SPA navigation between rooms and same-room game restarts (Zustand store recreation) without freezing on stale state.

---

## Install (unpacked, from source)

The extension is not on the Chrome Web Store. To use it you build it locally and load the `dist/` folder as an unpacked extension.

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer
- [pnpm](https://pnpm.io/) (recommended) or npm

### Build

```bash
git clone https://github.com/SergioMM0/Richup-Enhanced.git
cd Richup-Enhanced
pnpm install
pnpm build
```

The production bundle is written to `dist/`.

### Load into Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right).
3. Click **Load unpacked**.
4. Select the `dist/` folder from this repo.
5. Open [https://richup.io](https://richup.io) and join or create a room. The overlay activates on `https://richup.io/room/*`.

Right-click the extension icon in the toolbar → **Rich Up Enhanced Settings** to open the popup, or click the icon directly.

---

## Development

```bash
pnpm dev         # Vite dev server with HMR via @crxjs/vite-plugin
pnpm build       # Production build → dist/
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest unit tests for analytics calculations
pnpm icons       # Regenerate PNG icons from public/icons/icon.svg
```

During `pnpm dev`, load `dist/` in Chrome and the extension will hot-reload on file changes. You may need to manually reload the extension from `chrome://extensions` after manifest or background-script edits.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Language | TypeScript (strict) |
| Bundler | Vite + `@crxjs/vite-plugin` |
| Manifest | V3 |
| UI | Plain DOM in a Shadow root — no framework |
| Tests | Vitest |

No React, Vue, or Svelte — the host page already uses React, and a duplicate framework in the page's world causes hard-to-debug conflicts.

---

## Architecture (high level)

RUE runs two content scripts because Chrome content scripts live in an *isolated world* by default and cannot see React's `__reactFiber*` expandos that the page sets on DOM nodes.

```
┌─ MAIN world (src/content/main-world.ts) ──────────────────────┐
│  • Walks the React fiber tree to locate the Zustand store     │
│  • Subscribes; on each change, posts a JSON-serialized        │
│    snapshot to the isolated world via window.postMessage      │
│  • Every 2s, re-walks and swaps subscriptions if the store    │
│    reference changes (richup recreates the store on restart)  │
└────────────────────────────┬──────────────────────────────────┘
                             │ postMessage
┌─ ISOLATED world (src/content/index.ts) ───────────────────────┐
│  • store-relay.ts exposes a StateSource to the rest of the    │
│    iso-world code — overlays never touch the live store       │
│  • OverlayManager mounts a single Shadow-DOM host             │
│    and constructs each overlay                                │
│  • Owns session-key reset (state.id + state.stats.startedAt)  │
│    so per-game caches flush on new-game boundaries            │
│  • Reads/writes chrome.storage (settings + layout)            │
└───────────────────────────────────────────────────────────────┘
```

For the full design (fiber-walk safety rules, lifecycle boundaries, MV3 quirks, etc.), see [CLAUDE.md](CLAUDE.md).

---

## Repository layout

```
src/
├── content/
│   ├── main-world.ts         MAIN-world fiber walker + store bridge
│   ├── index.ts              Isolated-world bootstrap + URL watcher
│   ├── store-relay.ts        StateSource fed by postMessage
│   ├── protocol.ts           Typed MAIN ↔ ISO message envelope
│   ├── overlay-manager.ts    Shadow-DOM host + session-key reset
│   ├── overlays/
│   │   ├── landing-chips.ts          Per-player dice-sum chips
│   │   └── info-menu/                Draggable tabbed panel
│   └── analytics/            Pure rent/net-worth/ranking functions (tested)
├── popup/                    Settings UI
├── background/               Service worker (context menu)
└── shared/                   Types, settings, layout persistence
public/
├── icons/                    16/48/128 PNGs + source SVG
└── fonts/                    Twemoji Country Flags woff2
```

---

## Permissions

The extension requests the minimum needed to do its job:

| Permission | Why |
|---|---|
| `storage` | Persist user settings (`sync`) and panel geometry (`local`) |
| `contextMenus` | Add a "Settings" entry to the toolbar-icon right-click menu |
| `host_permissions: https://richup.io/*` | Inject the content scripts on richup.io only |

No analytics, no telemetry, no remote calls. All processing is local.

---

## Contributing

PRs welcome. A few ground rules to keep things sane:

- **Read [CLAUDE.md](CLAUDE.md) first.** It documents the host-page quirks (obfuscated CSS classes, isolated/main world split, store recreation on restart, etc.) that explain why the code is shaped the way it is.
- **Don't rely on minified class names** like `_1KW03nqs` — they change every deploy. Use `data-*` attributes and the stable `richup-block-*` classes.
- **Keep overlays read-only.** RUE deliberately never writes to the store or sends network requests.
- **Run `pnpm typecheck && pnpm test` before opening a PR.**

If you find a richup.io behavior that breaks an overlay, an issue with the room URL (redacted), browser version, and a console log is the most useful thing you can file.

---

## License

MIT. See [LICENSE](LICENSE) if present, otherwise: do what you want, no warranty.

---

## Disclaimer

Rich Up Enhanced is an independent fan project. It is not affiliated with, endorsed by, or sponsored by richup.io or its developers. "Monopoly" is a trademark of Hasbro; this project does not use that name and is intended only as an analytics layer for the publicly available richup.io browser game.
