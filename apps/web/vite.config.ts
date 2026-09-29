import vueJsx from '@vitejs/plugin-vue-jsx';
import { loadEnv } from 'vite';
// 与 vite 的 defineConfig 相同，只是类型里多了 test 字段
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // 前缀参数传空字符串，才能读到不带 VITE_ 前缀的 PROXY_TARGET；它只在这里使用，不会进入前端代码
  const env = loadEnv(mode, process.cwd(), '');
  const apiBaseUrl = env.VITE_API_BASE_URL;

  return {
    plugins: [vueJsx()],
    resolve: {
      // 直接读取 tsconfig 的 paths，不再单独维护一份别名
      tsconfigPaths: true
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
      include: ['src/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      // 每个用例结束后撤销 vi.stubEnv，避免影响其他用例
      unstubEnvs: true
    }
  };
});
