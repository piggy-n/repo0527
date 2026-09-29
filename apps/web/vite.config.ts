import vueJsx from '@vitejs/plugin-vue-jsx';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vueJsx()],
  resolve: {
    // 直接读取 tsconfig 的 paths，不再单独维护一份别名
    tsconfigPaths: true
  }
});
