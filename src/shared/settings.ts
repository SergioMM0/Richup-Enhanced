import type { RUESettings } from './types';

export const SETTINGS_KEY = 'rue:settings:v1';

export const DEFAULT_SETTINGS: RUESettings = {
  overlaysEnabled: true,
  showROIBadge: true,
  showRentInfo: true,
  showOwnerHighlight: true,
  showInfoMenu: true,
  overlayOpacity: 0.85,
};

export async function getSettings(): Promise<RUESettings> {
  const out = await chrome.storage.sync.get(SETTINGS_KEY);
  const stored = (out[SETTINGS_KEY] ?? {}) as Partial<RUESettings>;
  return { ...DEFAULT_SETTINGS, ...stored };
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
      | Partial<RUESettings>
      | undefined;
    cb({ ...DEFAULT_SETTINGS, ...(newValue ?? {}) });
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
