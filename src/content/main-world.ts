// This script runs in the page's MAIN world (NOT the extension's isolated world).
// It has no access to chrome.* APIs but CAN see React fiber expandos on DOM
// elements and walk the React tree to find the Zustand store. State is relayed
// to the isolated-world content script via window.postMessage.

import {
  MSG_SOURCE_MAIN,
  type DiagnosticReport,
  type MainToIsoMessage,
  isIsoToMain,
} from './protocol';

const TAG = '[RUE/main]';
const FIBER_PREFIX = '__reactFiber';
const FIBER_WALK_NODE_LIMIT = 20_000;
const ROOM_PATH_RE = /^\/room\/[^/]+/;

const ROOT_SELECTOR_CANDIDATES = [
  '#app',
  '#root',
  '#__next',
  'body > div:first-of-type',
];

interface ZustandStoreLike {
  getState: () => unknown;
  subscribe: (listener: (state: unknown, prev: unknown) => void) => () => void;
}

function getFiberFromElement(el: Element): unknown {
  for (const k of Object.keys(el)) {
    if (k.startsWith(FIBER_PREFIX)) {
      return (el as unknown as Record<string, unknown>)[k];
    }
  }
  return null;
}

function findReactRootEl(): { el: Element; fiber: unknown; selector: string } | null {
  for (const sel of ROOT_SELECTOR_CANDIDATES) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const fiber = getFiberFromElement(el);
    if (fiber) return { el, fiber, selector: sel };
  }
  // Fallback: any element with a fiber.
  for (const el of document.querySelectorAll('body *')) {
    const fiber = getFiberFromElement(el);
    if (fiber) return { el, fiber, selector: '<body-walk>' };
  }
  return null;
}

interface Candidate {
  store: ZustandStoreLike;
  rootKeys: string[];
  hasState: boolean;
  hasSelfParticipantId: boolean;
  hasIsReady: boolean;
}

function inspectCandidate(value: unknown): Candidate | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  // Real Zustand stores have all four. Being strict avoids invoking unknown
  // getState() functions on arbitrary Provider values that may hang or recurse.
  if (
    typeof v.getState !== 'function' ||
    typeof v.subscribe !== 'function' ||
    typeof v.setState !== 'function'
  ) {
    return null;
  }
  let root: Record<string, unknown> | null = null;
  try {
    const r = (v.getState as () => unknown)();
    if (r && typeof r === 'object') root = r as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!root) return null;
  return {
    store: value as ZustandStoreLike,
    rootKeys: Object.keys(root),
    hasState: 'state' in root,
    hasSelfParticipantId: 'selfParticipantId' in root,
    hasIsReady: 'isReady' in root,
  };
}

function score(c: Candidate): number {
  return (c.hasSelfParticipantId ? 5 : 0) + (c.hasState ? 3 : 0) + (c.hasIsReady ? 2 : 0);
}

type FiberNode = {
  tag?: number;
  memoizedProps?: Record<string, unknown> | null;
  memoizedState?: unknown;
  stateNode?: unknown;
  child?: FiberNode | null;
  sibling?: FiberNode | null;
  return?: FiberNode | null;
};

interface WalkResult {
  store: ZustandStoreLike | null;
  diagnostic: DiagnosticReport;
}

const PER_WALK_TIME_BUDGET_MS = 200;

function walkAndFind(): WalkResult {
  const startedAt = performance.now();
  const diagnostic: DiagnosticReport = {
    rootSelector: null,
    rootElTag: null,
    visited: 0,
    candidatesFound: 0,
    bestCandidateRootKeys: null,
    uniqueProviderTags: [],
    exampleKeysSeen: [],
  };
  const root = findReactRootEl();
  if (!root) return { store: null, diagnostic };
  diagnostic.rootSelector = root.selector;
  diagnostic.rootElTag = root.el.tagName.toLowerCase();

  // DFS via stack with O(1) pop, never shift. The previous BFS used
  // queue.shift() which is O(n) and turned the walk into O(n^2).
  const stack: FiberNode[] = [];
  const rootFiber = root.fiber as FiberNode;
  if (rootFiber.child) stack.push(rootFiber.child);
  if (rootFiber.sibling) stack.push(rootFiber.sibling);

  const providerTags = new Set<number>();
  const seen = new WeakSet<object>();
  let bestStore: ZustandStoreLike | null = null;
  let bestScore = -1;

  const tryValue = (val: unknown) => {
    const c = inspectCandidate(val);
    if (!c) return;
    diagnostic.candidatesFound++;
    // Require selfParticipantId — the distinctive richup game-store key. Without
    // this gate, generic Zustand stores on the page (ad loaders, intersection
    // trackers) score 0 but still beat the initial bestScore of -1.
    if (!c.hasSelfParticipantId) return;
    const s = score(c);
    if (s > bestScore) {
      bestStore = c.store;
      bestScore = s;
      diagnostic.bestCandidateRootKeys = c.rootKeys;
    }
  };

  while (stack.length && diagnostic.visited < FIBER_WALK_NODE_LIMIT) {
    const node = stack.pop()!;
    if (!node || (typeof node === 'object' && seen.has(node))) continue;
    seen.add(node);
    diagnostic.visited++;

    // Time budget: if a single walk exceeds the budget, bail out and let the
    // caller retry on the next interval. Prevents lockups on pathological trees.
    if (
      diagnostic.visited % 500 === 0 &&
      performance.now() - startedAt > PER_WALK_TIME_BUDGET_MS
    ) {
      break;
    }

    const props = node.memoizedProps;
    if (
      props &&
      typeof props === 'object' &&
      typeof node.tag === 'number' &&
      'value' in props
    ) {
      providerTags.add(node.tag);
      tryValue((props as Record<string, unknown>).value);
    }

    let hook = node.memoizedState as
      | { memoizedState?: unknown; next?: unknown }
      | null
      | undefined;
    if (hook && typeof hook === 'object') {
      let steps = 0;
      while (hook && typeof hook === 'object' && steps < 50) {
        tryValue(hook.memoizedState);
        hook = hook.next as typeof hook;
        steps++;
      }
    }

    tryValue(node.stateNode);

    if (
      props &&
      typeof props === 'object' &&
      diagnostic.exampleKeysSeen.length < 20
    ) {
      const k = Object.keys(props as object).slice(0, 3).join(',');
      if (k && !diagnostic.exampleKeysSeen.includes(k)) {
        diagnostic.exampleKeysSeen.push(k);
      }
    }

    if (node.child) stack.push(node.child);
    if (node.sibling) stack.push(node.sibling);
  }

  diagnostic.uniqueProviderTags = [...providerTags];
  return { store: bestStore, diagnostic };
}

let lastDiagnostic: DiagnosticReport | null = null;

async function waitForStore(intervalMs = 250): Promise<WalkResult> {
  // Polls indefinitely. The script now matches all richup.io URLs so it can be
  // present before the user SPA-navigates into /room/*; we skip the fiber walk
  // entirely on non-room paths to keep the lobby tab idle, and resume on the
  // next tick once the URL becomes a room.
  let last: WalkResult = {
    store: null,
    diagnostic: {
      rootSelector: null,
      rootElTag: null,
      visited: 0,
      candidatesFound: 0,
      bestCandidateRootKeys: null,
      uniqueProviderTags: [],
      exampleKeysSeen: [],
    },
  };
  let attempt = 0;
  let lastLoggedAt = 0;
  while (true) {
    if (ROOM_PATH_RE.test(location.pathname)) {
      last = walkAndFind();
      lastDiagnostic = last.diagnostic;
      attempt++;
      const now = Date.now();
      if (attempt === 1 || now - lastLoggedAt > 3000) {
        console.log(`${TAG} walk attempt ${attempt}`, last.diagnostic);
        lastLoggedAt = now;
      }
      if (last.store) return last;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function exposeMainWorldDebug(getStoreState: () => unknown) {
  (window as unknown as Record<string, unknown>).__RUE_MAIN = {
    diagnose: () => {
      const r = walkAndFind();
      console.log(`${TAG} diagnose →`, r.diagnostic, 'store:', r.store);
      return r;
    },
    getState: getStoreState,
    lastDiagnostic: () => lastDiagnostic,
  };
}

function postToIso(message: MainToIsoMessage): void {
  window.postMessage(message, location.origin);
}

/**
 * Strip non-cloneable values (functions, DOM nodes) from the state before
 * postMessage. We deep-clone via JSON which is sufficient for richup's state
 * (no Maps/Sets/Dates expected at the wire level — strings carry timestamps).
 */
function serializeState(state: unknown): unknown {
  try {
    return JSON.parse(
      JSON.stringify(state, (_k, v) => (typeof v === 'function' ? undefined : v)),
    );
  } catch (err) {
    console.warn(`${TAG} state serialization failed`, err);
    return null;
  }
}

let throttleScheduled = false;
let lastState: unknown = null;
function scheduleStatePush(state: unknown): void {
  lastState = state;
  if (throttleScheduled) return;
  throttleScheduled = true;
  requestAnimationFrame(() => {
    throttleScheduled = false;
    const serialized = serializeState(lastState);
    if (serialized == null) return;
    postToIso({
      source: MSG_SOURCE_MAIN,
      type: 'state',
      payload: serialized as never,
    });
  });
}

// Re-discovery cadence. Richup creates a fresh Zustand store when a new game
// starts in the same room (the host page tears down and remounts the game
// React tree); the original subscription then dangles silently. Every tick we
// re-walk the fiber tree and swap subscriptions if the live store reference
// has changed. The walk has its own 200ms time budget, so the worst-case CPU
// cost is bounded.
const REDISCOVERY_INTERVAL_MS = 2000;

async function bootstrap(): Promise<void> {
  console.log(`${TAG} starting fiber search`);
  // Expose a no-op debug handle right away so the console can probe even
  // before the search completes.
  exposeMainWorldDebug(() => null);

  const result = await waitForStore();
  let currentStore = result.store!;
  let lastDiag: DiagnosticReport = result.diagnostic;

  postToIso({
    source: MSG_SOURCE_MAIN,
    type: 'hello',
    payload: { storeFound: true, diagnostic: lastDiag },
  });
  console.log(`${TAG} store found`, lastDiag);
  exposeMainWorldDebug(() => currentStore.getState());

  // Push initial state immediately, then on every change.
  scheduleStatePush(currentStore.getState());
  let unsubscribe = currentStore.subscribe((s) => scheduleStatePush(s));

  // Respond to ad-hoc requests from isolated world.
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (!isIsoToMain(e.data)) return;
    if (e.data.type === 'request-state') {
      scheduleStatePush(currentStore.getState());
    }
    if (e.data.type === 'request-diagnostic') {
      postToIso({
        source: MSG_SOURCE_MAIN,
        type: 'hello',
        payload: { storeFound: true, diagnostic: lastDiag },
      });
    }
  });

  setInterval(() => {
    if (!ROOM_PATH_RE.test(location.pathname)) return;
    const r = walkAndFind();
    if (!r.store || r.store === currentStore) return;
    console.log(`${TAG} store reference replaced; resubscribing`, r.diagnostic);
    try {
      unsubscribe();
    } catch (err) {
      console.warn(`${TAG} old unsubscribe threw`, err);
    }
    currentStore = r.store;
    lastDiag = r.diagnostic;
    unsubscribe = currentStore.subscribe((s) => scheduleStatePush(s));
    // Push the fresh state immediately so the iso world doesn't have to wait
    // for the next host-side mutation. Signal the swap separately so the iso
    // world can flush per-game caches even when the new state's session-key
    // happens to match the old one.
    scheduleStatePush(currentStore.getState());
    postToIso({
      source: MSG_SOURCE_MAIN,
      type: 'store-replaced',
      payload: { diagnostic: lastDiag },
    });
    exposeMainWorldDebug(() => currentStore.getState());
  }, REDISCOVERY_INTERVAL_MS);

  window.addEventListener('beforeunload', () => {
    unsubscribe();
    postToIso({
      source: MSG_SOURCE_MAIN,
      type: 'gone',
      payload: { reason: 'beforeunload' },
    });
  });
}

bootstrap().catch((err) => {
  console.error(`${TAG} bootstrap crashed`, err);
});
