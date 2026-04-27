import { getSettings, saveSettings } from '@shared/settings';
import type { RUESettings } from '@shared/types';

type BoolKey = {
  [K in keyof RUESettings]: RUESettings[K] extends boolean ? K : never;
}[keyof RUESettings];

type NumKey = {
  [K in keyof RUESettings]: RUESettings[K] extends number ? K : never;
}[keyof RUESettings];

async function init() {
  const settings = await getSettings();

  document
    .querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-key]')
    .forEach((input) => {
      const key = input.dataset.key as BoolKey;
      input.checked = settings[key];
      input.addEventListener('change', () => {
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
      const setOutput = (v: number) => {
        if (out) out.value = `${Math.round(v * 100)}%`;
      };
      input.value = String(settings[key]);
      setOutput(settings[key]);
      input.addEventListener('input', () => {
        const v = Number(input.value);
        setOutput(v);
      });
      input.addEventListener('change', () => {
        const v = Number(input.value);
        void saveSettings({ [key]: v } as Partial<RUESettings>);
      });
    });
}

void init();
