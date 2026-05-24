import { DEFAULT_SETTINGS, getSettings, saveSettings } from '@shared/settings';
import type { RUESettings } from '@shared/types';

type BoolKey = {
  [K in keyof RUESettings]: RUESettings[K] extends boolean ? K : never;
}[keyof RUESettings];

type NumKey = {
  [K in keyof RUESettings]: RUESettings[K] extends number ? K : never;
}[keyof RUESettings];

type EnumKey = {
  [K in keyof RUESettings]: RUESettings[K] extends string ? K : never;
}[keyof RUESettings];

function applyValuesToInputs(settings: RUESettings): void {
  document
    .querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-key]')
    .forEach((input) => {
      const key = input.dataset.key as BoolKey;
      input.checked = settings[key];
    });

  document
    .querySelectorAll<HTMLInputElement>('input[type="range"][data-key]')
    .forEach((input) => {
      const key = input.dataset.key as NumKey;
      input.value = String(settings[key]);
      const out = document.querySelector<HTMLOutputElement>(
        `output[data-output-for="${key}"]`,
      );
      if (out) out.value = `${Math.round(settings[key] * 100)}%`;
    });

  document
    .querySelectorAll<HTMLSelectElement>('select[data-key]')
    .forEach((select) => {
      const key = select.dataset.key as EnumKey;
      select.value = String(settings[key]);
    });
}

async function init() {
  const settings = await getSettings();
  applyValuesToInputs(settings);

  document
    .querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-key]')
    .forEach((input) => {
      input.addEventListener('change', () => {
        const key = input.dataset.key as BoolKey;
        void saveSettings({ [key]: input.checked } as Partial<RUESettings>);
      });
    });

  document
    .querySelectorAll<HTMLInputElement>('input[type="range"][data-key]')
    .forEach((input) => {
      const key = input.dataset.key as NumKey;
      const out = document.querySelector<HTMLOutputElement>(
        `output[data-output-for="${key}"]`,
      );
      input.addEventListener('input', () => {
        if (out) out.value = `${Math.round(Number(input.value) * 100)}%`;
      });
      input.addEventListener('change', () => {
        void saveSettings({
          [key]: Number(input.value),
        } as Partial<RUESettings>);
      });
    });

  document
    .querySelectorAll<HTMLSelectElement>('select[data-key]')
    .forEach((select) => {
      select.addEventListener('change', () => {
        const key = select.dataset.key as EnumKey;
        void saveSettings({ [key]: select.value } as Partial<RUESettings>);
      });
    });

  const resetBtn = document.getElementById('reset');
  resetBtn?.addEventListener('click', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    applyValuesToInputs(DEFAULT_SETTINGS);
  });
}

void init();
