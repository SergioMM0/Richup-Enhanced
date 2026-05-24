import type {
  Auction,
  Block,
  Participant,
  RootStoreState,
  RUESettings,
  Trade,
} from '@shared/types';
import {
  DEFAULT_LAYOUT,
  getLayout,
  saveLayout,
  type InfoMenuLayout,
} from '@shared/layout';
import { formatMoney } from '../../analytics/player';
import { getCityFlagEmoji } from '../../analytics/flags';
import {
  findDisappearedTrades,
  inferResolution,
  type ResolvedEntry,
} from '../../analytics/trade-history';
import { AuctionView } from './auction-view';
import { HistoryView } from './history-view';
import { PlayersView } from './players-view';
import { TradesView } from './trades-view';
import type { InfoMenuView, ViewContext, ViewId } from './types';

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
}

const VIEWPORT_MARGIN = 8;
const DEFAULT_WIDTH = 320;
const RESIZE_SAVE_DEBOUNCE_MS = 250;
const TICK_INTERVAL_MS = 1000;

interface ViewEntry {
  view: InfoMenuView;
  tabEl: HTMLButtonElement;
  dotEl: HTMLSpanElement;
}

export class InfoMenuOverlay {
  private settings: RUESettings;
  private root: HTMLDivElement;
  private header: HTMLDivElement;
  private dragHandle: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private statusPillEl: HTMLSpanElement;
  private body: HTMLDivElement;
  private pendingStripEl: HTMLDivElement;
  private mainEl: HTMLDivElement;
  private railEl: HTMLDivElement;
  private viewBodyEl: HTMLDivElement;
  private bannerEl: HTMLDivElement;
  private winnerRibbonEl: HTMLDivElement;
  private collapseBtn: HTMLButtonElement;
  private collapsed = false;
  private collapsedLoaded = false;
  private lastState: RootStoreState | null = null;
  private pendingExpanded = false;
  // Bankrupt or kicked players can disappear from `participants` mid-game;
  // we snapshot their name/color on every push so past-trade entries keep
  // usable labels even after the player is gone.
  private participantSnapshot = new Map<
    string,
    { name: string; color: string }
  >();
  // Past-trade tracking (formerly the HistoryView): observe disappeared
  // trades, classify them, keep a small bounded log. Shell owns the
  // observation; exposed to views via ViewContext.resolvedEntries().
  private prevTradeIds = new Map<string, Trade>();
  private prevOwners = new Map<number, string | null>();
  private resolvedEntriesLog: ResolvedEntry[] = [];
  private readonly MAX_RESOLVED = 30;

  // View registry. Phase A registers only PlayersView; Phase B adds the
  // other three. The Map preserves insertion order, which we use as the
  // tab order in the rail.
  private views = new Map<ViewId, ViewEntry>();
  private activeViewId: ViewId = 'players';

  private layout: InfoMenuLayout = { ...DEFAULT_LAYOUT };
  private dragState: DragState | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeSaveTimer: number | null = null;
  // Tracks the last width/height we applied so the resize observer can ignore
  // changes we caused (initial apply, viewport clamps, collapse/expand) and
  // only persist user-driven resize-handle drags.
  private lastAppliedSize: { width: number; height: number } | null = null;
  // 1s ticker for auction countdown rerender. Cheap when there's no auction
  // (the render bails immediately) but always running while the panel exists
  // so the user doesn't see a stuck countdown if state pushes stall.
  private tickerId: number | null = null;
  // Coalesces multiple update() / requestUpdate() calls in the same animation
  // frame into a single render. State pushes can arrive in bursts (e.g. a
  // turn that triggers position + money + dice + bonus all in one tick) and
  // re-rendering the whole active view per push made detailed mode feel
  // glitchy.
  private renderRafId: number | null = null;
  private boundWindowResize = () => this.handleWindowResize();
  private boundPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
  private boundPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
  private boundPointerUp = (e: PointerEvent) => this.handlePointerUp(e);

  // Shared ViewContext handed to every registered view. Methods close over
  // `this`, so they always reflect the shell's current settings/log.
  private readonly viewContext: ViewContext = {
    requestUpdate: () => this.scheduleRender(),
    settings: () => this.settings,
    resolvedEntries: () => this.resolvedEntriesLog,
  };

  constructor(settings: RUESettings) {
    this.settings = settings;

    this.root = document.createElement('div');
    this.root.className = 'info-menu';

    this.header = document.createElement('div');
    this.header.className = 'info-menu__header';

    this.dragHandle = document.createElement('div');
    this.dragHandle.className = 'info-menu__drag-handle';
    this.dragHandle.title = 'Drag to move';
    this.dragHandle.setAttribute('aria-label', 'Drag to move');
    // U+2807 BRAILLE PATTERN DOTS-123 over a second char gives a clean 2x3
    // dot grid that reads as a drag grip in any monospace fallback.
    this.dragHandle.textContent = '⠇⠇';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'info-menu__title';
    this.titleEl.textContent = 'Rich Up';

    this.statusPillEl = document.createElement('span');
    this.statusPillEl.className = 'info-menu__status-pill';
    this.statusPillEl.hidden = true;

    this.collapseBtn = document.createElement('button');
    this.collapseBtn.type = 'button';
    this.collapseBtn.className = 'info-menu__collapse';
    this.collapseBtn.title = 'Collapse';
    this.collapseBtn.setAttribute('aria-label', 'Collapse');
    this.collapseBtn.textContent = '▾';
    this.collapseBtn.addEventListener('click', () => this.toggleCollapsed());

    this.header.appendChild(this.dragHandle);
    this.header.appendChild(this.titleEl);
    this.header.appendChild(this.statusPillEl);
    this.header.appendChild(this.collapseBtn);

    this.body = document.createElement('div');
    this.body.className = 'info-menu__body';

    this.pendingStripEl = document.createElement('div');
    this.pendingStripEl.className = 'info-menu__pending';
    this.pendingStripEl.hidden = true;

    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'info-menu__banner';
    this.bannerEl.hidden = true;

    this.winnerRibbonEl = document.createElement('div');
    this.winnerRibbonEl.className = 'info-menu__winner-ribbon';
    this.winnerRibbonEl.hidden = true;

    this.mainEl = document.createElement('div');
    this.mainEl.className = 'info-menu__main';

    this.railEl = document.createElement('div');
    this.railEl.className = 'info-menu__rail';
    this.railEl.setAttribute('role', 'tablist');

    this.viewBodyEl = document.createElement('div');
    this.viewBodyEl.className = 'info-menu__view-body';

    this.mainEl.appendChild(this.railEl);
    this.mainEl.appendChild(this.viewBodyEl);

    this.body.appendChild(this.bannerEl);
    this.body.appendChild(this.winnerRibbonEl);
    this.body.appendChild(this.mainEl);
    // Pending strip sits at the bottom so its appearance doesn't push the
    // players list down — easier to track at a glance.
    this.body.appendChild(this.pendingStripEl);

    this.root.appendChild(this.header);
    this.root.appendChild(this.body);

    this.header.addEventListener('pointerdown', this.boundPointerDown);

    this.registerView(new PlayersView());
    this.registerView(new TradesView());
    this.registerView(new AuctionView());
    this.registerView(new HistoryView());

    this.applySettings(this.settings);
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);

    // Apply default geometry synchronously so the panel renders in a sane
    // place on first paint, then load the persisted layout async and
    // override if anything was saved.
    this.applyLayout(this.layout);
    void this.loadLayout();

    this.resizeObserver = new ResizeObserver(() => this.handleSelfResize());
    this.resizeObserver.observe(this.root);

    window.addEventListener('resize', this.boundWindowResize);

    this.tickerId = window.setInterval(() => {
      // Re-render every second only when we have something time-sensitive
      // visible. Cheap idle path keeps the panel responsive without burning
      // a render-per-second when nothing's animating.
      const inner = this.lastState?.state;
      const auctionTabActive = this.activeViewId === 'auction';
      if (inner?.auction && (this.pendingExpanded || auctionTabActive)) {
        this.render();
      }
    }, TICK_INTERVAL_MS);
  }

  destroy(): void {
    this.header.removeEventListener('pointerdown', this.boundPointerDown);
    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);
    document.removeEventListener('pointercancel', this.boundPointerUp);
    window.removeEventListener('resize', this.boundWindowResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.resizeSaveTimer !== null) {
      clearTimeout(this.resizeSaveTimer);
      this.resizeSaveTimer = null;
    }
    if (this.tickerId !== null) {
      clearInterval(this.tickerId);
      this.tickerId = null;
    }
    if (this.renderRafId !== null) {
      cancelAnimationFrame(this.renderRafId);
      this.renderRafId = null;
    }
    for (const entry of this.views.values()) entry.view.destroy?.();
    this.views.clear();
    this.lastState = null;
    this.root.remove();
  }

  applySettings(settings: RUESettings): void {
    this.settings = settings;
    const visible = settings.overlaysEnabled && settings.showInfoMenu;
    this.root.style.display = visible ? '' : 'none';
    this.root.style.opacity = String(settings.overlayOpacity);
  }

  update(state: RootStoreState | null): void {
    this.lastState = state;
    if (state) {
      this.snapshotParticipants(state);
      this.observeTradeResolutions(state);
    }
    this.scheduleRender();
  }

  resetSession(): void {
    this.pendingExpanded = false;
    this.participantSnapshot.clear();
    this.prevTradeIds.clear();
    this.prevOwners.clear();
    this.resolvedEntriesLog = [];
    for (const entry of this.views.values()) entry.view.resetSession?.();
    this.lastState = null;
    this.scheduleRender();
  }

  // Coalesces render requests into rAF. Multiple calls within a single frame
  // collapse into one render(); state-tick storms (turn + position + money
  // + dice arriving in rapid succession) no longer rebuild the active view
  // multiple times per frame.
  private scheduleRender(): void {
    if (this.renderRafId !== null) return;
    this.renderRafId = requestAnimationFrame(() => {
      this.renderRafId = null;
      this.render();
    });
  }

  // ------------------------------------------------------------------
  // View registry
  // ------------------------------------------------------------------

  private registerView(view: InfoMenuView): void {
    const tabEl = document.createElement('button');
    tabEl.type = 'button';
    tabEl.className = 'info-menu__rail-tab';
    tabEl.setAttribute('role', 'tab');
    tabEl.dataset.viewId = view.id;
    tabEl.title = view.label;
    tabEl.setAttribute('aria-label', view.label);

    const iconEl = document.createElement('span');
    iconEl.className = 'info-menu__rail-icon';
    iconEl.textContent = view.icon;

    const dotEl = document.createElement('span');
    dotEl.className = 'info-menu__rail-dot';
    dotEl.hidden = true;

    tabEl.appendChild(iconEl);
    tabEl.appendChild(dotEl);
    tabEl.addEventListener('click', () => this.setActiveView(view.id));

    this.railEl.appendChild(tabEl);
    this.views.set(view.id, { view, tabEl, dotEl });

    view.attach?.(this.viewContext);
    this.updateRailSelection();
  }

  private setActiveView(id: ViewId): void {
    if (!this.views.has(id) || this.activeViewId === id) return;
    this.activeViewId = id;
    this.updateRailSelection();
    this.render();
  }

  private updateRailSelection(): void {
    for (const [id, entry] of this.views) {
      entry.tabEl.setAttribute(
        'aria-selected',
        id === this.activeViewId ? 'true' : 'false',
      );
    }
  }

  private snapshotParticipants(state: RootStoreState): void {
    const ps = state.state?.participants;
    if (!Array.isArray(ps)) return;
    for (const p of ps) {
      this.participantSnapshot.set(p.id, {
        name: p.name,
        color: p.appearance,
      });
    }
  }

  // Mirrors the old HistoryView.observeStateInner logic: each tick, compare
  // the trade list to the previous snapshot, classify anything that
  // disappeared, and remember it. Bounded to MAX_RESOLVED so memory stays
  // small over a long game.
  private observeTradeResolutions(state: RootStoreState): void {
    const inner = state.state;
    if (!inner) return;
    if (inner.phase !== 'playing' && inner.phase !== 'ended') return;

    const currentTrades = Array.isArray(inner.trades) ? inner.trades : [];
    const currentIds = new Set(currentTrades.map((t) => t.id));
    const currentBlocks = Array.isArray(inner.blocks) ? inner.blocks : [];

    const disappeared = findDisappearedTrades(this.prevTradeIds, currentIds);
    if (disappeared.length > 0) {
      const now = Date.now();
      // Newest-first: iterate the disappeared list in reverse and unshift so
      // the latest resolution lands at index 0 of the visible log.
      for (let i = disappeared.length - 1; i >= 0; i--) {
        const trade = disappeared[i]!;
        const kind = inferResolution(
          trade,
          currentTrades,
          this.prevOwners,
          currentBlocks,
        );
        if (kind === 'counter-offered') continue;
        const initiator = this.participantSnapshot.get(trade.initiatorId);
        const recipient = this.participantSnapshot.get(trade.recipientId);
        this.resolvedEntriesLog.unshift({
          trade,
          outcome: kind,
          resolvedAt: now,
          initiatorName: initiator?.name ?? 'Unknown',
          initiatorColor: initiator?.color ?? '#888',
          recipientName: recipient?.name ?? 'Unknown',
          recipientColor: recipient?.color ?? '#888',
        });
      }
      if (this.resolvedEntriesLog.length > this.MAX_RESOLVED) {
        this.resolvedEntriesLog.length = this.MAX_RESOLVED;
      }
    }

    const nextTrades = new Map<string, Trade>();
    for (const t of currentTrades) nextTrades.set(t.id, t);
    this.prevTradeIds = nextTrades;

    this.prevOwners.clear();
    for (let i = 0; i < currentBlocks.length; i++) {
      const b = currentBlocks[i];
      this.prevOwners.set(i, b && 'ownerId' in b ? b.ownerId : null);
    }
  }

  // ------------------------------------------------------------------
  // Render entry point
  // ------------------------------------------------------------------

  private render(): void {
    const state = this.lastState;
    const inner = state?.state;
    const phase = inner?.phase;

    if (!state || !inner) {
      this.renderBanner(this.makeConnectingBanner());
      return;
    }

    if (phase === 'lobby') {
      this.renderBanner(this.makeLobbyBanner(inner.participants ?? []));
      return;
    }

    this.bannerEl.hidden = true;
    this.bannerEl.replaceChildren();
    this.mainEl.hidden = false;

    if (phase === 'ended') {
      // Keep rail + active view visible so the user can browse final
      // standings on the Players tab; show a slim winner ribbon above.
      this.renderWinnerRibbon(inner.participants ?? [], inner.winnerId);
      this.pendingStripEl.hidden = true;
      this.pendingStripEl.replaceChildren();
      this.statusPillEl.hidden = true;
      this.refreshRailDots(state);
      this.renderActiveView(state);
      return;
    }

    this.winnerRibbonEl.hidden = true;
    this.winnerRibbonEl.replaceChildren();

    this.renderPendingStrip(state);
    this.renderActiveView(state);
    this.renderStatusPill(state);
    this.refreshRailDots(state);
  }

  private renderWinnerRibbon(
    participants: Participant[],
    winnerId: string | null,
  ): void {
    const winner = winnerId
      ? participants.find((p) => p.id === winnerId)
      : null;
    this.winnerRibbonEl.hidden = false;
    this.winnerRibbonEl.replaceChildren();
    if (winner) {
      this.winnerRibbonEl.style.setProperty('--tab-color', winner.appearance);
      this.winnerRibbonEl.classList.add('info-menu__winner-ribbon--has-winner');
      this.winnerRibbonEl.textContent = `🏆 ${winner.name} wins`;
    } else {
      this.winnerRibbonEl.classList.remove('info-menu__winner-ribbon--has-winner');
      this.winnerRibbonEl.textContent = 'Game over';
    }
  }

  private renderActiveView(state: RootStoreState): void {
    const entry = this.views.get(this.activeViewId);
    if (!entry) {
      this.viewBodyEl.replaceChildren();
      return;
    }
    this.viewBodyEl.replaceChildren(entry.view.render(state));
  }

  private refreshRailDots(state: RootStoreState | null): void {
    for (const entry of this.views.values()) {
      const has = entry.view.hasNotification?.(state) ?? false;
      entry.dotEl.hidden = !has;
    }
  }

  private renderBanner(node: HTMLElement): void {
    this.bannerEl.hidden = false;
    this.bannerEl.replaceChildren(node);
    this.pendingStripEl.hidden = true;
    this.pendingStripEl.replaceChildren();
    this.winnerRibbonEl.hidden = true;
    this.winnerRibbonEl.replaceChildren();
    this.mainEl.hidden = true;
    this.viewBodyEl.replaceChildren();
    this.statusPillEl.hidden = true;
    for (const entry of this.views.values()) entry.dotEl.hidden = true;
  }

  // ------------------------------------------------------------------
  // Header status pill
  // ------------------------------------------------------------------

  private renderStatusPill(state: RootStoreState): void {
    const inner = state.state;
    const currentId = inner.participants?.[inner.currentPlayerIndex]?.id;
    if (!currentId) {
      this.statusPillEl.hidden = true;
      return;
    }
    const self = state.selfParticipantId;
    if (currentId === self) {
      this.statusPillEl.hidden = false;
      this.statusPillEl.textContent = 'Your turn';
      this.statusPillEl.classList.add('info-menu__status-pill--you');
    } else {
      this.statusPillEl.hidden = true;
      this.statusPillEl.classList.remove('info-menu__status-pill--you');
    }
  }

  // ------------------------------------------------------------------
  // Pending strip (auction + open trades)
  // ------------------------------------------------------------------

  private renderPendingStrip(state: RootStoreState): void {
    const inner = state.state;
    const selfId = state.selfParticipantId;
    const auction = inner.auction;
    const trades = Array.isArray(inner.trades) ? inner.trades : [];
    const myTrades = trades.filter(
      (t) => t.initiatorId === selfId || t.recipientId === selfId,
    );

    // The strip stays mounted in playing phase regardless of content so the
    // menu's main area doesn't reflow every time an auction starts or a
    // trade lands. Empty state gets a muted placeholder; the lobby/ended
    // banners still hide the strip via renderBanner / the ended branch.
    this.pendingStripEl.hidden = false;

    if (!auction && myTrades.length === 0) {
      this.pendingExpanded = false;
      this.pendingStripEl.classList.add('info-menu__pending--empty');
      const empty = document.createElement('div');
      empty.className = 'info-menu__pending-empty';
      empty.textContent = 'Nothing pending';
      this.pendingStripEl.replaceChildren(empty);
      return;
    }

    this.pendingStripEl.classList.remove('info-menu__pending--empty');
    const lines = document.createElement('div');
    lines.className = 'info-menu__pending-lines';

    if (auction) {
      const block = inner.blocks?.[auction.blockIndex];
      lines.appendChild(this.renderAuctionLine(auction, block, inner.participants ?? []));
    }
    if (myTrades.length > 0) {
      lines.appendChild(
        this.renderTradesLine(myTrades, inner.participants ?? [], selfId),
      );
    }

    lines.addEventListener('click', () => {
      this.pendingExpanded = !this.pendingExpanded;
      this.render();
    });

    this.pendingStripEl.replaceChildren(lines);

    if (this.pendingExpanded) {
      const detail = document.createElement('div');
      detail.className = 'info-menu__pending-detail';
      if (auction) {
        detail.appendChild(
          this.renderAuctionDetail(auction, inner.blocks ?? [], inner.participants ?? []),
        );
      }
      if (myTrades.length > 0) {
        detail.appendChild(
          this.renderTradesDetail(
            myTrades,
            inner.participants ?? [],
            inner.blocks ?? [],
          ),
        );
      }
      this.pendingStripEl.appendChild(detail);
    }
  }

  private renderAuctionLine(
    auction: Auction,
    block: Block | undefined,
    participants: Participant[],
  ): HTMLElement {
    const line = document.createElement('div');
    line.className = 'info-menu__pending-line info-menu__pending-line--auction';

    const icon = document.createElement('span');
    icon.className = 'info-menu__pending-icon';
    icon.textContent = '⏱';

    const label = document.createElement('span');
    label.className = 'info-menu__pending-text';
    const tileName = block && 'name' in block ? block.name : 'tile';
    const { topBid, topBidderId } = this.topBid(auction);
    const bidder = participants.find((p) => p.id === topBidderId);
    if (topBid > 0) {
      label.textContent = `Auction: ${tileName} · ${formatMoney(topBid)} (${bidder?.name ?? '—'})`;
    } else {
      label.textContent = `Auction: ${tileName} · no bids`;
    }

    const time = document.createElement('span');
    time.className = 'info-menu__pending-time';
    time.textContent = this.formatCountdown(auction.endAt);

    line.appendChild(icon);
    line.appendChild(label);
    line.appendChild(time);
    return line;
  }

  private renderTradesLine(
    trades: Trade[],
    participants: Participant[],
    selfId: string,
  ): HTMLElement {
    const line = document.createElement('div');
    line.className = 'info-menu__pending-line info-menu__pending-line--trades';

    const icon = document.createElement('span');
    icon.className = 'info-menu__pending-icon';
    icon.textContent = '🤝';

    const label = document.createElement('span');
    label.className = 'info-menu__pending-text';
    if (trades.length === 1) {
      const t = trades[0]!;
      const other = participants.find(
        (p) => p.id === (t.initiatorId === selfId ? t.recipientId : t.initiatorId),
      );
      const direction =
        t.initiatorId === selfId
          ? `you → ${other?.name ?? '—'}`
          : `${other?.name ?? '—'} → you`;
      label.textContent = `Trade: ${direction}`;
    } else {
      label.textContent = `${trades.length} open trades`;
    }

    line.appendChild(icon);
    line.appendChild(label);
    return line;
  }

  private renderAuctionDetail(
    auction: Auction,
    blocks: Block[],
    participants: Participant[],
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'info-menu__pending-block';

    const block = blocks[auction.blockIndex];
    const title = document.createElement('div');
    title.className = 'info-menu__pending-block-title';
    title.textContent = block && 'name' in block ? block.name : 'Tile';
    wrap.appendChild(title);

    if (block && 'price' in block && typeof block.price === 'number') {
      wrap.appendChild(this.simpleRow('List price', formatMoney(block.price)));
    }

    const bidEntries = Object.entries(auction.bids ?? {}).sort(
      ([, a], [, b]) => b - a,
    );
    if (bidEntries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'info-menu__empty';
      empty.textContent = 'No bids yet';
      wrap.appendChild(empty);
    } else {
      for (const [id, amount] of bidEntries) {
        const p = participants.find((x) => x.id === id);
        const row = this.simpleRow(p?.name ?? id, formatMoney(amount));
        if (p) row.style.setProperty('--tab-color', p.appearance);
        row.classList.add('info-menu__row--bid');
        wrap.appendChild(row);
      }
    }
    return wrap;
  }

  private renderTradesDetail(
    trades: Trade[],
    participants: Participant[],
    blocks: Block[],
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'info-menu__pending-block';

    for (const trade of trades) {
      const initiator = participants.find((p) => p.id === trade.initiatorId);
      const recipient = participants.find((p) => p.id === trade.recipientId);
      const card = document.createElement('div');
      card.className = 'info-menu__pending-trade';

      const title = document.createElement('div');
      title.className = 'info-menu__pending-block-title';
      title.textContent = `${initiator?.name ?? 'Unknown'} → ${recipient?.name ?? 'Unknown'}`;
      card.appendChild(title);

      card.appendChild(
        this.tradeSideRows(`${initiator?.name ?? '?'} gives`, trade.initiatorOffer, blocks),
      );
      card.appendChild(
        this.tradeSideRows(`${recipient?.name ?? '?'} gives`, trade.recipientOffer, blocks),
      );

      wrap.appendChild(card);
    }

    return wrap;
  }

  private tradeSideRows(
    label: string,
    side: Trade['initiatorOffer'] | undefined,
    blocks: Block[],
  ): HTMLElement {
    const group = document.createElement('div');
    group.className = 'info-menu__pending-side';
    const heading = document.createElement('div');
    heading.className = 'info-menu__property-group-title';
    heading.textContent = label;
    group.appendChild(heading);

    const money = typeof side?.money === 'number' ? side.money : 0;
    const indexes = Array.isArray(side?.propertyIndices)
      ? side.propertyIndices
      : [];
    const mortgaged = new Set(
      Array.isArray(side?.mortgagedPropertiesIndexes)
        ? side.mortgagedPropertiesIndexes
        : [],
    );
    if (money > 0) group.appendChild(this.simpleRow('Cash', formatMoney(money)));
    for (const idx of indexes) {
      const b = blocks[idx];
      const suffix = mortgaged.has(idx) ? ' (mortgaged)' : '';
      group.appendChild(this.simpleRow('Property', `${this.blockLabel(b)}${suffix}`));
    }
    if (money === 0 && indexes.length === 0) {
      group.appendChild(this.simpleRow('—', 'nothing'));
    }
    return group;
  }

  private topBid(auction: Auction): {
    topBid: number;
    topBidderId: string | null;
  } {
    let topBid = 0;
    let topBidderId: string | null = null;
    for (const [id, amount] of Object.entries(auction.bids ?? {})) {
      if (amount > topBid) {
        topBid = amount;
        topBidderId = id;
      }
    }
    return { topBid, topBidderId };
  }

  private formatCountdown(endAt: string): string {
    const end = Date.parse(endAt);
    if (Number.isNaN(end)) return '';
    const secs = Math.max(0, Math.round((end - Date.now()) / 1000));
    if (secs < 60) return `${secs}s`;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ------------------------------------------------------------------
  // Empty / transition state banners
  // ------------------------------------------------------------------

  private makeConnectingBanner(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'info-menu__banner-inner';
    const title = document.createElement('div');
    title.className = 'info-menu__banner-title';
    title.textContent = 'Connecting…';
    const sub = document.createElement('div');
    sub.className = 'info-menu__banner-sub';
    sub.textContent = 'Waiting for game state.';
    wrap.appendChild(title);
    wrap.appendChild(sub);
    return wrap;
  }

  private makeLobbyBanner(participants: Participant[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'info-menu__banner-inner';

    const title = document.createElement('div');
    title.className = 'info-menu__banner-title';
    title.textContent = 'Waiting for game to start';

    const sub = document.createElement('div');
    sub.className = 'info-menu__banner-sub';
    sub.textContent = `${participants.length} player${participants.length === 1 ? '' : 's'} in the lobby`;

    const dots = document.createElement('div');
    dots.className = 'info-menu__banner-dots';
    for (const p of participants) {
      const dot = document.createElement('span');
      dot.className = 'info-menu__banner-dot';
      dot.style.background = p.appearance;
      dot.title = p.name;
      dots.appendChild(dot);
    }

    wrap.appendChild(title);
    wrap.appendChild(sub);
    if (participants.length > 0) wrap.appendChild(dots);
    return wrap;
  }

  // ------------------------------------------------------------------
  // Small DOM helpers (still used by pending strip rendering)
  // ------------------------------------------------------------------

  private simpleRow(label: string, value: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'info-menu__row';
    const l = document.createElement('span');
    l.className = 'info-menu__row-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'info-menu__row-value';
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  private blockLabel(block: Block | undefined): string {
    if (!block) return '?';
    if (block.type === 'city') {
      const flag = getCityFlagEmoji(block);
      return flag ? `${flag} ${block.name}` : block.name;
    }
    if (block.type === 'airport') return `✈ ${block.name}`;
    if (block.type === 'company') return `⚙ ${block.name}`;
    return block.type;
  }

  // ------------------------------------------------------------------
  // Collapse + layout persistence + drag/resize (mostly unchanged)
  // ------------------------------------------------------------------

  private toggleCollapsed(): void {
    this.setCollapsed(!this.collapsed);
    this.layout = { ...this.layout, collapsed: this.collapsed };
    void saveLayout({ collapsed: this.collapsed });
  }

  private setCollapsed(next: boolean): void {
    this.collapsed = next;
    this.root.classList.toggle('info-menu--collapsed', this.collapsed);
    this.collapseBtn.title = this.collapsed ? 'Expand' : 'Collapse';
    this.collapseBtn.setAttribute(
      'aria-label',
      this.collapsed ? 'Expand' : 'Collapse',
    );
    if (this.collapsed) {
      this.root.style.height = 'auto';
      this.lastAppliedSize = null;
    } else {
      this.applyLayout(this.layout);
    }
  }

  private async loadLayout(): Promise<void> {
    const stored = await getLayout();
    this.layout = stored;
    if (!this.collapsedLoaded) {
      this.collapsedLoaded = true;
      if (stored.collapsed !== this.collapsed) this.setCollapsed(stored.collapsed);
    }
    this.applyLayout(stored);
  }

  // Apply persisted geometry (or defaults) to the root, clamped to the
  // current viewport so a saved position from a larger monitor doesn't leave
  // the panel stranded off-screen.
  private applyLayout(layout: InfoMenuLayout): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = VIEWPORT_MARGIN;
    const minWidth = 240;
    const minHeight = 160;
    const maxWidth = Math.max(minWidth, vw - margin * 2);
    const maxHeight = Math.max(minHeight, vh - margin * 2);

    const width = clamp(layout.width ?? DEFAULT_WIDTH, minWidth, maxWidth);
    const defaultHeight = Math.min(Math.round(vh * 0.6), 600);
    const height = clamp(layout.height ?? defaultHeight, minHeight, maxHeight);

    const defaultLeft = vw - width - 16;
    const defaultTop = vh - height - 16;
    const left = clamp(layout.left ?? defaultLeft, margin, vw - width - margin);
    const top = clamp(layout.top ?? defaultTop, margin, vh - minHeight - margin);

    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
    this.root.style.right = 'auto';
    this.root.style.bottom = 'auto';
    this.root.style.width = `${width}px`;
    if (!this.collapsed) {
      this.root.style.height = `${height}px`;
      this.lastAppliedSize = { width, height };
    } else {
      this.root.style.height = 'auto';
      this.lastAppliedSize = null;
    }
  }

  private handleSelfResize(): void {
    if (this.collapsed) return;
    const rect = this.root.getBoundingClientRect();
    if (
      this.lastAppliedSize &&
      Math.abs(rect.width - this.lastAppliedSize.width) < 1 &&
      Math.abs(rect.height - this.lastAppliedSize.height) < 1
    ) {
      return;
    }
    this.lastAppliedSize = { width: rect.width, height: rect.height };
    this.layout = {
      ...this.layout,
      width: rect.width,
      height: rect.height,
    };
    this.queueSaveLayout();
  }

  private handleWindowResize(): void {
    this.applyLayout(this.layout);
  }

  private queueSaveLayout(): void {
    if (this.resizeSaveTimer !== null) clearTimeout(this.resizeSaveTimer);
    this.resizeSaveTimer = window.setTimeout(() => {
      this.resizeSaveTimer = null;
      void saveLayout({
        left: this.layout.left,
        top: this.layout.top,
        width: this.layout.width,
        height: this.layout.height,
      });
    }, RESIZE_SAVE_DEBOUNCE_MS);
  }

  private handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button')) return;
    e.preventDefault();
    const rect = this.root.getBoundingClientRect();
    this.dragState = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    };
    this.root.classList.add('info-menu--dragging');
    document.addEventListener('pointermove', this.boundPointerMove);
    document.addEventListener('pointerup', this.boundPointerUp);
    document.addEventListener('pointercancel', this.boundPointerUp);
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.dragState || e.pointerId !== this.dragState.pointerId) return;
    const dx = e.clientX - this.dragState.startX;
    const dy = e.clientY - this.dragState.startY;
    const rect = this.root.getBoundingClientRect();
    const margin = VIEWPORT_MARGIN;
    const left = clamp(
      this.dragState.startLeft + dx,
      margin,
      window.innerWidth - rect.width - margin,
    );
    const top = clamp(
      this.dragState.startTop + dy,
      margin,
      window.innerHeight - rect.height - margin,
    );
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
    this.layout = { ...this.layout, left, top };
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.dragState || e.pointerId !== this.dragState.pointerId) return;
    this.dragState = null;
    this.root.classList.remove('info-menu--dragging');
    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);
    document.removeEventListener('pointercancel', this.boundPointerUp);
    this.queueSaveLayout();
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
