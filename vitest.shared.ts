import { playwright } from '@vitest/browser-playwright';
import type { BrowserConfigOptions } from 'vitest/node';

/** 浏览器测试共用的设置（ADR 0040）：应用和各个包用同一份，渲染后端和视口不会各写各的 */
export const browserTestOptions: BrowserConfigOptions = {
  // 默认是 false：不写的话这些用例仍在 Node / jsdom 里跑
  enabled: true,
  // 显式选软件渲染，减少本机和 CI 之间的差异
  provider: playwright({ launchOptions: { args: ['--use-angle=swiftshader'] } }),
  headless: true,
  viewport: { width: 1280, height: 800 },
  // 不做截图比对，CI 也不上传附件：失败时不往仓库目录写截图
  screenshotFailures: false,
  instances: [{ browser: 'chromium' }]
};
