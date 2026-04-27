export interface InfoMenuLayout {
  left: number | null;
  top: number | null;
  width: number | null;
  height: number | null;
}

export const LAYOUT_KEY = 'rue:layout:v1';

export const DEFAULT_LAYOUT: InfoMenuLayout = {
  left: null,
  top: null,
  width: null,
  height: null,
};

// chrome.storage.local rather than .sync: panel geometry is genuinely per-device
// (laptop vs 4K monitor), and drag/resize bursts can outpace sync's write quota.
export async function getLayout(): Promise<InfoMenuLayout> {
  try {
    const out = await chrome.storage.local.get(LAYOUT_KEY);
    const stored = (out[LAYOUT_KEY] ?? {}) as Partial<InfoMenuLayout>;
    return { ...DEFAULT_LAYOUT, ...stored };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export async function saveLayout(patch: Partial<InfoMenuLayout>): Promise<void> {
  try {
    const current = await getLayout();
    const next = { ...current, ...patch };
    await chrome.storage.local.set({ [LAYOUT_KEY]: next });
  } catch {
    // chrome.storage can throw inside disconnected/iframed contexts; ignore.
  }
}
