import { fileURLToPath } from 'node:url';
import { defineConfig } from 'playwright/test';

// 只预览已经构建的产物；测试结束后由 Playwright 关闭预览进程
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.spec.ts',
  outputDir: fileURLToPath(new URL('../../smoke-results.local', import.meta.url)),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
    actionTimeout: 15_000,
    navigationTimeout: 15_000,
    launchOptions: { args: ['--use-angle=swiftshader'] }
  },
  webServer: {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30_000
  }
});
