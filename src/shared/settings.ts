import type { RUESettings } from './types';

export const SETTINGS_KEY = 'rue:settings:v1';

export const DEFAULT_SETTINGS: RUESettings = {
  overlaysEnabled: true,
  showInfoMenu: true,
  showLandingChips: true,
  disableHoverLandingChips: false,
  overlayOpacity: 0.85,
  theme: 'dark',
  densityMode: 'compact',
};

// Strips legacy keys from stored settings before merging with defaults. Keeps
// `getSettings()` total against the current `RUESettings` shape no matter what
// older builds wrote to `chrome.storage.sync` previously.
function normalize(stored: Record<string, unknown>): Partial<RUESettings> {
  const { showLandingChipsForCurrentTurn: _drop, ...rest } = stored as {
    showLandingChipsForCurrentTurn?: unknown;
  } & Record<string, unknown>;
  void _drop;
  return rest as Partial<RUESettings>;
}

export async function getSettings(): Promise<RUESettings> {
  const out = await chrome.storage.sync.get(SETTINGS_KEY);
  const stored = (out[SETTINGS_KEY] ?? {}) as Record<string, unknown>;
  return { ...DEFAULT_SETTINGS, ...normalize(stored) };
}

export async function saveSettings(patch: Partial<RUESettings>): Promise<void> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
}

export function onSettingsChange(
  cb: (settings: RUESettings) => void,
): () => void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: chrome.storage.AreaName,
  ) => {
    if (area !== 'sync') return;
    if (!(SETTINGS_KEY in changes)) return;
    const newValue = changes[SETTINGS_KEY]?.newValue as
      | Record<string, unknown>
      | undefined;
    cb({ ...DEFAULT_SETTINGS, ...normalize(newValue ?? {}) });
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
