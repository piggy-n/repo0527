import vueJsx from '@vitejs/plugin-vue-jsx';
import { configDefaults, defineConfig } from 'vitest/config';
import { browserTestOptions } from '../../vitest.shared.ts';

export default defineConfig({
  plugins: [vueJsx()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: [...configDefaults.exclude, 'src/**/*.browser.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['src/test-setup.ts']
        }
      },
      {
        extends: true,
        test: {
          name: 'browser',
          // MapLibre 用软件 WebGL，逐文件执行避免渲染资源竞争
          fileParallelism: false,
          include: ['src/**/*.browser.test.{ts,tsx}'],
          setupFiles: ['src/test-setup.ts', 'src/test-setup.browser.ts'],
          browser: browserTestOptions
        }
      }
    ]
  }
});
