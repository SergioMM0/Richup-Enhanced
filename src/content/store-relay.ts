import type { RootStoreState } from '@shared/types';
import {
  MSG_SOURCE_ISO,
  type DiagnosticReport,
  type IsoToMainMessage,
  isMainToIso,
} from './protocol';

/**
 * Isolated-world facade that mirrors the Zustand store interface
 * but is fed by postMessage events from the main-world script.
 */
export interface StateSource {
  getState: () => RootStoreState | null;
  subscribe: (cb: (s: RootStoreState) => void) => () => void;
  // Fired when the MAIN world reports the underlying Zustand store reference
  // has been replaced (e.g. richup creates a fresh store for a new game in
  // the same room). Consumers should treat it as a hard "discard per-game
  // caches" signal — a fresh state push always follows.
  onStoreReplaced: (cb: () => void) => () => void;
  getLastDiagnostic: () => DiagnosticReport | null;
}

export interface RelayBootResult {
  source: StateSource;
  storeFound: boolean;
  diagnostic: DiagnosticReport | null;
}

function postToMain(message: IsoToMainMessage): void {
  window.postMessage(message, location.origin);
}

class Relay implements StateSource {
  private latest: RootStoreState | null = null;
  private listeners = new Set<(s: RootStoreState) => void>();
  private replacedListeners = new Set<() => void>();
  private lastDiagnostic: DiagnosticReport | null = null;

  constructor() {
    window.addEventListener('message', (e) => this.onMessage(e));
  }

  private onMessage(e: MessageEvent): void {
    if (e.source !== window) return;
    if (!isMainToIso(e.data)) return;
    const msg = e.data;
    if (msg.type === 'state') {
      this.latest = msg.payload as RootStoreState;
      for (const cb of this.listeners) {
        try {
          cb(this.latest);
        } catch (err) {
          console.warn('[RUE] state listener threw', err);
        }
      }
    } else if (msg.type === 'hello') {
      this.lastDiagnostic = msg.payload.diagnostic;
    } else if (msg.type === 'store-replaced') {
      this.lastDiagnostic = msg.payload.diagnostic;
      // Drop the stale snapshot so any synchronous getState() after this
      // point doesn't leak the dead game's data while we wait for the
      // post-replace state push (which MAIN sends right after this signal).
      this.latest = null;
      for (const cb of this.replacedListeners) {
        try {
          cb();
        } catch (err) {
          console.warn('[RUE] store-replaced listener threw', err);
        }
      }
    } else if (msg.type === 'gone') {
      this.latest = null;
    }
  }

  getState(): RootStoreState | null {
    return this.latest;
  }

  subscribe(cb: (s: RootStoreState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onStoreReplaced(cb: () => void): () => void {
    this.replacedListeners.add(cb);
    return () => this.replacedListeners.delete(cb);
  }

  getLastDiagnostic(): DiagnosticReport | null {
    return this.lastDiagnostic;
  }

  requestState(): void {
    postToMain({ source: MSG_SOURCE_ISO, type: 'request-state' });
  }
}

const singleton = new Relay();

export function getStateSource(): StateSource {
  return singleton;
}

/**
 * Wait until the main-world script has reported either success or its first
 * diagnostic, AND we have at least one state snapshot. Resolves to a snapshot
 * of what we know.
 */
export async function waitForRelayReady(timeoutMs = 30_000): Promise<RelayBootResult> {
  const deadline = Date.now() + timeoutMs;
  // Ask for a state push in case the main script is already alive.
  postToMain({ source: MSG_SOURCE_ISO, type: 'request-diagnostic' });
  postToMain({ source: MSG_SOURCE_ISO, type: 'request-state' });

  while (Date.now() < deadline) {
    const state = singleton.getState();
    const diag = singleton.getLastDiagnostic();
    if (state) {
      return { source: singleton, storeFound: true, diagnostic: diag };
    }
    if (diag && !state) {
      // Main script reported but no store found yet — keep waiting in case
      // the page becomes ready, but only briefly.
      await new Promise((r) => setTimeout(r, 250));
      continue;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    source: singleton,
    storeFound: !!singleton.getState(),
    diagnostic: singleton.getLastDiagnostic(),
  };
}
