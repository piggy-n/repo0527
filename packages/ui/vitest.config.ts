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
          setupFiles: ['src/test-setup.ts'],
          // Vitest 默认把样式文件替换成空内容（带 ?raw 也一样）；Sass 入口要按原文读取，供断点一致性测试使用
          css: { include: [/\/src\/_index\.scss/] },
          // 交给 Node 直接加载时，element-plus 会拿到 CommonJS 版的 async-validator（见 docs/config/vite-config.md）
          server: { deps: { inline: ['element-plus'] } }
        }
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.{ts,tsx}'],
          setupFiles: ['src/test-setup.ts'],
          browser: browserTestOptions
        }
      }
    ]
  }
});
