import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Rich Up Enhanced',
  short_name: 'RUE',
  version: '0.1.0',
  description: 'Game analytics and intelligence overlay for richup.io',
  permissions: ['storage', 'contextMenus'],
  host_permissions: ['https://richup.io/*'],
  content_scripts: [
    {
      // Match all richup.io pages so the scripts are present when the user
      // SPA-navigates from the lobby into /room/*. Per-script gating on the
      // /room/* path is enforced inside the scripts themselves.
      matches: ['https://richup.io/*'],
      js: ['src/content/main-world.ts'],
      run_at: 'document_idle',
      world: 'MAIN',
    },
    {
      matches: ['https://richup.io/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  action: {
    default_popup: 'src/popup/popup.html',
    default_icon: {
      '16': 'public/icons/icon16.png',
      '48': 'public/icons/icon48.png',
      '128': 'public/icons/icon128.png',
    },
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  icons: {
    '16': 'public/icons/icon16.png',
    '48': 'public/icons/icon48.png',
    '128': 'public/icons/icon128.png',
  },
});
