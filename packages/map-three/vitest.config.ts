import { configDefaults, defineConfig } from 'vitest/config';
import { browserTestOptions } from '../../vitest.shared.ts';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'src/**/*.browser.test.ts'],
          environment: 'jsdom'
        }
      },
      {
        extends: true,
        test: {
          name: 'browser',
          // MapLibre 和 Three 用软件 WebGL，逐文件执行避免渲染资源竞争
          fileParallelism: false,
          include: ['src/**/*.browser.test.ts'],
          setupFiles: ['src/test-setup.browser.ts'],
          browser: browserTestOptions
        }
      }
    ]
  }
});
