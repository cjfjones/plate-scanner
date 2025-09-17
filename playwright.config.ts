import { defineConfig } from '@playwright/test';

export default defineConfig({
  webServer: {
    command: 'npm run serve',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  testDir: 'tests/e2e',
});
