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

  applyConditionalReveals(settings);
}

// Rows tagged with `data-reveal-when-off="<key>"` only appear when their
// gating checkbox is off. Used today by the on-hover landing-prediction
// sub-option, which is irrelevant while the main toggle is on.
function applyConditionalReveals(settings: RUESettings): void {
  document
    .querySelectorAll<HTMLElement>('[data-reveal-when-off]')
    .forEach((row) => {
      const key = row.dataset.revealWhenOff as BoolKey;
      row.hidden = settings[key] === true;
    });
}

async function init() {
  const settings = await getSettings();
  applyValuesToInputs(settings);

  document
    .querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-key]')
    .forEach((input) => {
      input.addEventListener('change', async () => {
        const key = input.dataset.key as BoolKey;
        await saveSettings({ [key]: input.checked } as Partial<RUESettings>);
        // Conditional-reveal rows key off this checkbox's value, so toggle
        // them in lockstep instead of waiting for a settings round-trip.
        applyConditionalReveals(await getSettings());
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
