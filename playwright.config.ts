import { defineConfig, devices } from '@playwright/test';
import { worktreeIdentity } from './scripts/worktree';
const { webPort } = worktreeIdentity();
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, retries: 0, workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: `http://127.0.0.1:${webPort}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
  webServer: { command: `node node_modules/next/dist/bin/next start apps/web --hostname 127.0.0.1 --port ${webPort}`, url: `http://127.0.0.1:${webPort}/api/health`, reuseExistingServer: false },
});
