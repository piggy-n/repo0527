import { viteStaticCopy } from 'vite-plugin-static-copy';
import { configDefaults, defineConfig } from 'vitest/config';
import { browserTestOptions } from '../../vitest.shared.ts';

export default defineConfig({
  plugins: [
    // 浏览器测试用真实的 Cesium：Worker、资源和第三方文件按基础地址 /cesium/ 请求（ADR 0079 第 1 节）
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
          include: ['src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'src/**/*.browser.test.ts'],
          environment: 'jsdom'
        }
      },
      {
        extends: true,
        test: {
          name: 'browser',
          // Cesium 用软件 WebGL，逐文件执行避免渲染资源竞争
          fileParallelism: false,
          include: ['src/**/*.browser.test.ts'],
          browser: browserTestOptions
        }
      }
    ]
  }
});
