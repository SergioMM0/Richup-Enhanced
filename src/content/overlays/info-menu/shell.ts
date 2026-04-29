import type { RootStoreState, RUESettings } from '@shared/types';
import {
  DEFAULT_LAYOUT,
  getLayout,
  saveLayout,
  type InfoMenuLayout,
} from '@shared/layout';
import { PlayersView } from './players-view';
import { RankingView } from './ranking-view';
import { TradesView } from './trades-view';
import type { InfoMenuView } from './types';

interface ViewEntry {
  view: InfoMenuView;
  tabEl: HTMLButtonElement;
}

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

export class InfoMenuOverlay {
  private settings: RUESettings;
  private root: HTMLDivElement;
  private header: HTMLDivElement;
  private dragHandle: HTMLDivElement;
  private viewTabsEl: HTMLDivElement;
  private subHeaderEl: HTMLDivElement;
  private body: HTMLDivElement;
  private collapseBtn: HTMLButtonElement;
  private views = new Map<string, ViewEntry>();
  private viewOrder: string[] = [];
  private activeViewId: string | null = null;
  private collapsed = false;
  private lastState: RootStoreState | null = null;

  private layout: InfoMenuLayout = { ...DEFAULT_LAYOUT };
  private dragState: DragState | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeSaveTimer: number | null = null;
  // Tracks the last width/height we applied so the resize observer can ignore
  // changes we caused (initial apply, viewport clamps, collapse/expand) and
  // only persist user-driven resize-handle drags.
  private lastAppliedSize: { width: number; height: number } | null = null;
  private boundWindowResize = () => this.handleWindowResize();
  private boundPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
  private boundPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
  private boundPointerUp = (e: PointerEvent) => this.handlePointerUp(e);

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

    this.viewTabsEl = document.createElement('div');
    this.viewTabsEl.className = 'info-menu__view-tabs';
    this.viewTabsEl.setAttribute('role', 'tablist');

    this.collapseBtn = document.createElement('button');
    this.collapseBtn.type = 'button';
    this.collapseBtn.className = 'info-menu__collapse';
    this.collapseBtn.title = 'Collapse';
    this.collapseBtn.setAttribute('aria-label', 'Collapse');
    this.collapseBtn.textContent = '▾';
    this.collapseBtn.addEventListener('click', () => this.toggleCollapsed());

    this.header.appendChild(this.dragHandle);
    this.header.appendChild(this.viewTabsEl);
    this.header.appendChild(this.collapseBtn);

    this.subHeaderEl = document.createElement('div');
    this.subHeaderEl.className = 'info-menu__sub-header';

    this.body = document.createElement('div');
    this.body.className = 'info-menu__body';

    this.root.appendChild(this.header);
    this.root.appendChild(this.subHeaderEl);
    this.root.appendChild(this.body);

    this.header.addEventListener('pointerdown', this.boundPointerDown);

    this.registerView(new PlayersView());
    this.registerView(new RankingView());
    this.registerView(new TradesView());

    this.applySettings(this.settings);
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);

    // Apply default geometry synchronously so the panel renders in a sane
    // place on first paint, then load the persisted layout async and
    // override if anything was saved.
    this.applyLayout(this.layout);
    void this.loadLayout();

    this.resizeObserver = new ResizeObserver(() =>
      this.handleSelfResize(),
    );
    this.resizeObserver.observe(this.root);

    window.addEventListener('resize', this.boundWindowResize);
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
    for (const entry of this.views.values()) entry.view.destroy?.();
    this.views.clear();
    this.viewOrder = [];
    this.activeViewId = null;
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
    this.renderActiveView();
  }

  resetSession(): void {
    for (const entry of this.views.values()) entry.view.resetSession?.();
    this.lastState = null;
    this.renderActiveView();
  }

  private registerView(view: InfoMenuView): void {
    if (this.views.has(view.id)) return;

    const tabEl = document.createElement('button');
    tabEl.type = 'button';
    tabEl.className = 'info-menu__view-tab';
    tabEl.setAttribute('role', 'tab');
    tabEl.dataset.viewId = view.id;
    tabEl.textContent = view.label;
    tabEl.title = view.label;
    tabEl.addEventListener('click', () => this.setActiveView(view.id));
    this.viewTabsEl.appendChild(tabEl);

    this.views.set(view.id, { view, tabEl });
    this.viewOrder.push(view.id);

    view.attach?.({ requestUpdate: () => this.renderActiveView() });

    if (this.activeViewId === null) this.activeViewId = view.id;
    this.updateViewTabSelection();
  }

  private setActiveView(id: string): void {
    if (!this.views.has(id) || this.activeViewId === id) return;
    this.activeViewId = id;
    this.updateViewTabSelection();
    this.renderActiveView();
  }

  private updateViewTabSelection(): void {
    for (const [id, entry] of this.views) {
      const selected = id === this.activeViewId;
      entry.tabEl.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
  }

  private renderActiveView(): void {
    if (!this.activeViewId) return;
    const entry = this.views.get(this.activeViewId);
    if (!entry) return;

    const sub = entry.view.renderSubHeader?.(this.lastState) ?? null;
    if (sub) this.subHeaderEl.replaceChildren(sub);
    else this.subHeaderEl.replaceChildren();

    this.body.replaceChildren(entry.view.renderBody(this.lastState));
  }

  private toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    this.root.classList.toggle('info-menu--collapsed', this.collapsed);
    this.collapseBtn.title = this.collapsed ? 'Expand' : 'Collapse';
    this.collapseBtn.setAttribute(
      'aria-label',
      this.collapsed ? 'Expand' : 'Collapse',
    );
    if (this.collapsed) {
      // Drop the explicit height while collapsed so the panel shrinks to
      // header-only; the saved height is restored on expand.
      this.root.style.height = 'auto';
      this.lastAppliedSize = null;
    } else {
      this.applyLayout(this.layout);
    }
  }

  private async loadLayout(): Promise<void> {
    const stored = await getLayout();
    this.layout = stored;
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
    // Height defaults to a sensible fraction of the viewport — capped so the
    // panel doesn't dominate on a tall screen.
    const defaultHeight = Math.min(Math.round(vh * 0.6), 600);
    const height = clamp(
      layout.height ?? defaultHeight,
      minHeight,
      maxHeight,
    );

    // Default position: bottom-right with a 16px gutter (matches the prior
    // CSS-anchored placement).
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
    // Ignore: collapsed (auto-sized header), or the change matches what we
    // just applied programmatically.
    if (this.collapsed) return;
    const rect = this.root.getBoundingClientRect();
    if (
      this.lastAppliedSize &&
      Math.abs(rect.width - this.lastAppliedSize.width) < 1 &&
      Math.abs(rect.height - this.lastAppliedSize.height) < 1
    ) {
      return;
    }
    // Treat as user-driven: update tracking and persist (debounced).
    this.lastAppliedSize = { width: rect.width, height: rect.height };
    this.layout = {
      ...this.layout,
      width: rect.width,
      height: rect.height,
    };
    this.queueSaveLayout();
  }

  private handleWindowResize(): void {
    // Re-apply current layout so any out-of-bounds position/size gets clamped
    // back into the viewport. Don't persist — we only save deliberate user
    // actions.
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
    // Buttons (tabs, collapse) keep their own click semantics.
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
