import { OverlayManager } from './overlay-manager';
import { getSettings, onSettingsChange } from '@shared/settings';
import { getStateSource, waitForRelayReady } from './store-relay';

const TAG = '[RUE]';
const ROOM_PATH_RE = /^\/room\/[^/]+/;

let manager: OverlayManager | null = null;
let lastPath = '';

declare global {
  interface Window {
    __RUE?: {
      getState: () => unknown;
      diagnostic: () => unknown;
      manager: OverlayManager | null;
    };
  }
}

function exposeDebug() {
  const src = getStateSource();
  window.__RUE = {
    getState: () => src.getState(),
    diagnostic: () => src.getLastDiagnostic(),
    manager,
  };
}

async function start(): Promise<void> {
  if (manager) return;
  if (!ROOM_PATH_RE.test(location.pathname)) return;

  console.log(`${TAG} bootstrapping on ${location.href}`);
  exposeDebug();

  const result = await waitForRelayReady();
  if (!result.storeFound) {
    console.warn(`${TAG} main-world relay never delivered a state snapshot`);
    console.warn(`${TAG} diagnostic:`, result.diagnostic);
    return;
  }
  console.log(`${TAG} state stream live`, result.diagnostic);

  const settings = await getSettings();
  manager = new OverlayManager(result.source, settings);
  manager.init();
  console.log(`${TAG} overlay manager initialized`);
  if (window.__RUE) window.__RUE.manager = manager;

  onSettingsChange((next) => {
    manager?.setSettings(next);
  });
}

function stop(): void {
  manager?.destroy();
  manager = null;
}

function watchUrlChanges(): void {
  lastPath = location.pathname;
  const checkUrl = () => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    console.log(`${TAG} URL changed to ${location.pathname}`);
    stop();
    if (ROOM_PATH_RE.test(location.pathname)) {
      void start();
    }
  };
  const wrap = (key: 'pushState' | 'replaceState') => {
    const original = history[key].bind(history);
    history[key] = ((...args: Parameters<History[typeof key]>) => {
      const result = original(...(args as [unknown, string, string?]));
      window.dispatchEvent(new Event('rue:locationchange'));
      return result;
    }) as History[typeof key];
  };
  wrap('pushState');
  wrap('replaceState');
  window.addEventListener('popstate', checkUrl);
  window.addEventListener('rue:locationchange', checkUrl);
}

watchUrlChanges();
void start();
