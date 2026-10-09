import { fileURLToPath } from 'node:url';
import vueJsx from '@vitejs/plugin-vue-jsx';
import { iconsPlugin } from '@yzt/icons/tools';
import { loadEnv } from 'vite';
// 与 vite 的 defineConfig 相同，只是类型里多了 test 字段
import { defineConfig } from 'vitest/config';
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
    plugins: [vueJsx(), ...generators],
    resolve: {
      // 直接读取 tsconfig 的 paths，不再单独维护一份别名
      tsconfigPaths: true
    },
    css: {
      preprocessorOptions: {
        // libs 模块的 Sass 入口按模块名引用，如 @use 'ui' 对应 src/libs/ui/_index.scss
        scss: { loadPaths: [fileURLToPath(new URL('./src/libs', import.meta.url))] }
      }
    },
    server: {
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
      include: ['src/**/*.test.{ts,tsx}', 'tools/**/*.test.ts'],
      environment: 'jsdom',
      setupFiles: ['src/test-setup.ts'],
      // 把转换结果缓存到 node_modules/.vitest-cache，之后的运行跳过转换（见 docs/config/vite-config.md）
      fsModuleCache: true,
      // 每个用例结束后撤销 vi.stubEnv，避免影响其他用例
      unstubEnvs: true,
      // Vitest 默认把样式文件替换成空内容（带 ?raw 也一样）；libs 的 Sass 入口要按原文读取，供断点一致性测试使用
      css: { include: [/\/src\/libs\/[^/]+\/_index\.scss/] },
      // 交给 Node 直接加载时，element-plus 会拿到 CommonJS 版的 async-validator，表单校验在测试中永远通过（见 docs/config/vite-config.md）
      server: { deps: { inline: ['element-plus'] } }
    }
  };
});
