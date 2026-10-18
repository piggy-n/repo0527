import { fileURLToPath } from 'node:url';
import vueJsx from '@vitejs/plugin-vue-jsx';
import { playwright } from '@vitest/browser-playwright';
import { iconsPlugin } from '@yzt/icons/tools';
import { loadEnv } from 'vite';
// 与 vite 的 defineConfig 相同，只是类型里多了 test 字段
import { configDefaults, defineConfig } from 'vitest/config';
import { buildOutputPlugin } from './tools/build-output/vite-plugin.ts';
import { cesiumAssetsPlugin } from './tools/cesium-assets/vite-plugin.ts';
import { iconsPaths } from './tools/icons/paths.ts';
import { titleOutlineConfig } from './tools/system-title/paths.ts';
import { systemTitlePlugin } from './tools/system-title/vite-plugin.ts';

export default defineConfig(({ mode }) => {
  // 前缀参数传空字符串，才能读到不带 VITE_ 前缀的 PROXY_TARGET；它只在这里使用，不会进入前端代码
  const env = loadEnv(mode, process.cwd(), '');
  const apiBaseUrl = env.VITE_API_BASE_URL;

  // 这两个插件会改动源文件（生成标题轮廓、规范化图标）；测试只检查已提交的结果，不启用
  const generators =
    mode === 'test'
      ? []
      : [
          systemTitlePlugin(titleOutlineConfig(process.cwd(), env.VITE_APP_TITLE)),
          iconsPlugin(iconsPaths(process.cwd()))
        ];

  return {
    plugins: [vueJsx(), ...generators, ...cesiumAssetsPlugin(), buildOutputPlugin()],
    resolve: {
      // 直接读取 tsconfig 的 paths，不再单独维护一份别名
      tsconfigPaths: true
    },
    // Worker 与业务样式验证的延迟依赖预先纳入同一优化批次，避免测试途中重载
    optimizeDeps: { include: ['@mapbox/vector-tile', 'pbf', 'core-js/es/symbol/dispose',
      '@turf/boolean-point-in-polygon', '@turf/bbox-clip', '@turf/bbox', '@turf/boolean-intersects',
      '@turf/intersect', '@turf/simplify', 'axios'] },
    css: {
      preprocessorOptions: {
        // libs 模块的 Sass 入口按模块名引用，如 @use 'ui' 对应 src/libs/ui/_index.scss
        scss: { loadPaths: [fileURLToPath(new URL('./src/libs', import.meta.url))] }
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
        }
      }
    },
    test: {
      // 把转换结果缓存到 node_modules/.vitest-cache，之后的运行跳过转换（见 docs/config/vite-config.md）
      fsModuleCache: true,
      // 每个用例结束后撤销 vi.stubEnv，避免影响其他用例
      unstubEnvs: true,
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
            // Vitest 默认把样式文件替换成空内容（带 ?raw 也一样）；libs 的 Sass 入口要按原文读取，供断点一致性测试使用
            css: { include: [/\/src\/libs\/[^/]+\/_index\.scss/] },
            // 交给 Node 直接加载时，element-plus 会拿到 CommonJS 版的 async-validator，表单校验在测试中永远通过（见 docs/config/vite-config.md）
            server: { deps: { inline: ['element-plus'] } }
          }
        },
        {
          extends: true,
          test: {
            name: 'browser',
            // 软件 WebGL 的多场景并发会争用渲染资源，按文件依次验证，普通测试仍并行
            fileParallelism: false,
            include: ['src/**/*.browser.test.{ts,tsx}'],
            setupFiles: ['src/test-setup.ts', 'src/test-setup.browser.ts'],
            browser: {
              // 默认是 false：不写的话这些用例仍在 Node / jsdom 里跑
              enabled: true,
              // 显式选软件渲染，减少本机和 CI 之间的差异
              provider: playwright({ launchOptions: { args: ['--use-angle=swiftshader'] } }),
              headless: true,
              viewport: { width: 1280, height: 800 },
              // 不做截图比对，CI 也不上传附件：失败时不往仓库目录写截图
              screenshotFailures: false,
              instances: [{ browser: 'chromium' }]
            }
          }
        }
      ]
    }
  };
});
