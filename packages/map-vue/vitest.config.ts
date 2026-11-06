import vueJsx from '@vitejs/plugin-vue-jsx';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { configDefaults, defineConfig } from 'vitest/config';
import { browserTestOptions } from '../../vitest.shared.ts';

export default defineConfig({
  plugins: [
    vueJsx(),
    // 三维的契约测试用真实的 Cesium（ADR 0147 第 3 节）：Worker、资源和第三方文件按基础地址 /cesium/ 请求
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/cesium/Build/Cesium/{Workers,Assets,ThirdParty}/**/*',
          dest: 'cesium',
          // 去掉 node_modules/cesium/Build/Cesium 四层，保留 Workers 等目录
          rename: { stripBase: 4 }
        }
      ]
    })
  ],
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
          // MapLibre、Cesium 用软件 WebGL，逐文件执行避免渲染资源竞争
          fileParallelism: false,
          include: ['src/**/*.browser.test.{ts,tsx}'],
          setupFiles: ['src/test-setup.ts', 'src/test-setup.browser.ts'],
          browser: browserTestOptions
        }
      }
    ]
  }
});
