import type { RootStoreState } from '@shared/types';

export const MSG_SOURCE_MAIN = 'rue-main';
export const MSG_SOURCE_ISO = 'rue-iso';

export type MainToIsoMessage =
  | { source: typeof MSG_SOURCE_MAIN; type: 'hello'; payload: { storeFound: boolean; diagnostic: DiagnosticReport } }
  | { source: typeof MSG_SOURCE_MAIN; type: 'state'; payload: RootStoreState }
  | { source: typeof MSG_SOURCE_MAIN; type: 'gone'; payload: { reason: string } };

export type IsoToMainMessage =
  | { source: typeof MSG_SOURCE_ISO; type: 'request-state' }
  | { source: typeof MSG_SOURCE_ISO; type: 'request-diagnostic' };

export interface DiagnosticReport {
  rootSelector: string | null;
  rootElTag: string | null;
  visited: number;
  candidatesFound: number;
  bestCandidateRootKeys: string[] | null;
  uniqueProviderTags: number[];
  exampleKeysSeen: string[];
}

export function isMainToIso(m: unknown): m is MainToIsoMessage {
  return (
    !!m &&
    typeof m === 'object' &&
    (m as { source?: unknown }).source === MSG_SOURCE_MAIN
  );
}

export function isIsoToMain(m: unknown): m is IsoToMainMessage {
  return (
    !!m &&
    typeof m === 'object' &&
    (m as { source?: unknown }).source === MSG_SOURCE_ISO
  );
}
