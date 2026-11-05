import { fileURLToPath } from 'node:url';
import { defineConfig } from 'playwright/test';

// 只预览已经构建的产物；测试结束后由 Playwright 关闭预览进程
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.spec.ts',
  // 放在这个检出自己的 local/，不跟 YZT_LOCAL_DIR：每次运行先清空，共用会让多个 worktree 互相删掉记录
  outputDir: fileURLToPath(new URL('../../../../local/smoke-results', import.meta.url)),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // 这个时限也管创建浏览器上下文（用例里的 test.setTimeout 这时还没生效），三维用例之后可能很慢
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // CI 上把失败写成注解：作业日志要登录才能看，注解不用
  reporter: process.env.CI ? [['line'], ['github']] : 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
    actionTimeout: 30_000,
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
