import vueJsx from '@vitejs/plugin-vue-jsx';
import { iconsPlugin } from '@yzt/icons/tools';
import { loadEnv, normalizePath } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
// 与 vite 的 defineConfig 相同，只是类型里多了 test 字段
import { configDefaults, defineConfig } from 'vitest/config';
import { browserTestOptions } from '../../vitest.shared.ts';
import { buildOutputPlugin } from './tools/build-output/vite-plugin.ts';
import { iconsPaths } from './tools/icons/paths.ts';
import { localPath } from './tools/local-files/paths.ts';
import { localFilesPlugin } from './tools/local-files/vite-plugin.ts';
import { titleOutlineConfig } from './tools/system-title/paths.ts';
import { systemTitlePlugin } from './tools/system-title/vite-plugin.ts';

export default defineConfig(({ mode }) => {
  // 前缀参数传空字符串，才能读到不带 VITE_ 前缀的 PROXY_TARGET；它只在这里使用，不会进入前端代码
  const env = loadEnv(mode, process.cwd(), '');
  const apiBaseUrl = env.VITE_API_BASE_URL;
  const aiApiBaseUrl = env.VITE_AI_API_BASE_URL;

  // 这两个插件会改动源文件（生成标题轮廓、规范化图标）；测试只检查已提交的结果，不启用
  const generators =
    mode === 'test'
      ? []
      : [
          systemTitlePlugin(titleOutlineConfig(process.cwd(), env.VITE_APP_TITLE)),
          iconsPlugin(iconsPaths(process.cwd()))
        ];

  // Cesium 按基础地址请求的 Worker、资源和第三方文件，复制到产物的 cesium/，开发服务器同样提供（ADR 0079 第 1 节）；
  // 测试也要：浏览器测试用真实的 Cesium。资源的最小显示级别复制到产物根目录，部署时换这个文件就能改（ADR 0137）
  const staticFiles = viteStaticCopy({
    targets: [
      {
        src: 'node_modules/cesium/Build/Cesium/{Workers,Assets,ThirdParty}/**/*',
        dest: 'cesium',
        // 去掉 node_modules/cesium/Build/Cesium 四层，保留 Workers 等目录
        rename: { stripBase: 4 }
      },
      {
        src: 'src/features/resource-map/resource-min-zooms.json',
        dest: '.',
        rename: { stripBase: 3 }
      }
    ]
  });

  // 模型和原型不入库、不进产物，开发时从 local/ 提供，地址和线上一致（ADR 0141）
  const localFiles = localFilesPlugin({ '/3dt': localPath('3dt'), '/design.local': localPath('design') });

  return {
    plugins: [vueJsx(), ...generators, staticFiles, localFiles, buildOutputPlugin()],
    resolve: {
      // 直接读取 tsconfig 的 paths，不再单独维护一份别名
      tsconfigPaths: true
    },
    build: {
      rolldownOptions: {
        output: {
          // 包的入口都是 src/index.ts，分块默认会叫 src；换成包名（如 map-cesium），产物里才认得出
          chunkFileNames: ({ facadeModuleId, name }) => {
            const packageName = /\/packages\/([^/]+)\/src\/index\.ts$/.exec(normalizePath(facadeModuleId ?? ''))?.[1];
            return `assets/${packageName ?? name}-[hash].js`;
          }
        }
      }
    },
    server: {
      // 预览工具用 PORT 分配端口（.claude/launch.json 的 autoPort），被占用时直接失败；没有 PORT 时沿用 Vite 的默认端口
      ...(env.PORT ? { port: Number(env.PORT), strictPort: true } : {}),
      // vite preview 默认沿用这里的代理
      proxy: {
        [`${apiBaseUrl}/`]: {
          target: env.PROXY_TARGET,
          changeOrigin: true,
          rewrite: path => path.slice(apiBaseUrl.length)
        },
        // AI 对话的后端是另一个服务（docs/modules/ai-chat.md）
        [`${aiApiBaseUrl}/`]: {
          target: env.AI_PROXY_TARGET,
          changeOrigin: true,
          rewrite: path => path.slice(aiApiBaseUrl.length)
        }
      }
    },
    test: {
      // 把转换结果缓存到 node_modules/.vitest-cache，之后的运行跳过转换（见 docs/config/vite-config.md）
      fsModuleCache: true,
      // 每个用例结束后撤销 vi.stubEnv，避免影响其他用例
      unstubEnvs: true,
      // 部署时决定的开关，很多用例依赖它的默认行为：固定下来，改 .env 不影响测试（ADR 0132、0140）
      env: {
        VITE_RESOURCE_MIN_ZOOM_ENABLED: 'true',
        VITE_PREFERENCES_ENABLED: 'true',
        VITE_PREFERENCE_BASEMAP: 'true',
        VITE_PREFERENCE_BOUNDARIES: 'true',
        VITE_PREFERENCE_RESOURCE_LAYERS: 'true',
        VITE_PREFERENCE_RESOURCE_SYMBOLS: 'true',
        VITE_PREFERENCE_RESOURCE_PANEL: 'true'
      },
      // 两个项目继承上面的插件、别名和 Sass 配置（ADR 0040）
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            include: ['src/**/*.test.{ts,tsx}', 'tools/**/*.test.ts'],
            exclude: [...configDefaults.exclude, 'src/**/*.browser.test.{ts,tsx}'],
            environment: 'jsdom',
            setupFiles: ['src/test-setup.ts'],
            // 交给 Node 直接加载时，element-plus 会拿到 CommonJS 版的 async-validator，表单校验在测试中永远通过（见 docs/config/vite-config.md）
            server: { deps: { inline: ['element-plus'] } }
          }
        },
        {
          extends: true,
          // 跨测试文件才出现的应用依赖提前构建，避免干净环境运行中重载页面
          optimizeDeps: {
            include: [
              'axios',
              '@tanstack/vue-query',
              'core-js/es/disposable-stack',
              'core-js/es/symbol/dispose',
              'element-plus/es/locale/lang/zh-cn',
              'jwt-decode',
              'pinia',
              'vue-router'
            ]
          },
          test: {
            name: 'browser',
            // MapLibre 与驾驶舱共用软件 WebGL，逐文件执行避免渲染资源竞争
            fileParallelism: false,
            include: ['src/**/*.browser.test.{ts,tsx}'],
            setupFiles: ['src/test-setup.ts', 'src/test-setup.browser.ts'],
            browser: browserTestOptions
          }
        }
      ]
    }
  };
});
