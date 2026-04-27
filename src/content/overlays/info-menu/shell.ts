import type { RootStoreState, RUESettings } from '@shared/types';
import { PlayersView } from './players-view';
import type { InfoMenuView } from './types';

interface ViewEntry {
  view: InfoMenuView;
  tabEl: HTMLButtonElement;
}

export class InfoMenuOverlay {
  private settings: RUESettings;
  private root: HTMLDivElement;
  private viewTabsEl: HTMLDivElement;
  private subHeaderEl: HTMLDivElement;
  private body: HTMLDivElement;
  private collapseBtn: HTMLButtonElement;
  private views = new Map<string, ViewEntry>();
  private viewOrder: string[] = [];
  private activeViewId: string | null = null;
  private collapsed = false;
  private lastState: RootStoreState | null = null;

  constructor(settings: RUESettings) {
    this.settings = settings;

    this.root = document.createElement('div');
    this.root.className = 'info-menu';

    const header = document.createElement('div');
    header.className = 'info-menu__header';

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

    header.appendChild(this.viewTabsEl);
    header.appendChild(this.collapseBtn);

    this.subHeaderEl = document.createElement('div');
    this.subHeaderEl.className = 'info-menu__sub-header';

    this.body = document.createElement('div');
    this.body.className = 'info-menu__body';

    this.root.appendChild(header);
    this.root.appendChild(this.subHeaderEl);
    this.root.appendChild(this.body);

    this.registerView(new PlayersView());

    this.applySettings(this.settings);
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
  }

  destroy(): void {
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
  }
}
