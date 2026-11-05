import { fileURLToPath } from 'node:url';
import { defineConfig } from 'playwright/test';

// 独立的短时测试服务，只提供本地固定接口，退出后由 Playwright 清理
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.spec.ts',
  // 放在这个检出自己的 local/，不跟 YZT_LOCAL_DIR：每次运行先清空，共用会让多个 worktree 互相删掉记录
  outputDir: fileURLToPath(new URL('../../../../local/file-transfer-results', import.meta.url)),
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4186',
    browserName: 'chromium',
    headless: true,
    serviceWorkers: 'block'
  },
  webServer: {
    command: 'node tools/file-transfer/serve.ts',
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: 'http://127.0.0.1:4186/transfer-test',
    reuseExistingServer: false,
    timeout: 30_000
  }
});
