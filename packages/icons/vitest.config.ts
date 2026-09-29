import vueJsx from '@vitejs/plugin-vue-jsx';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vueJsx()],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tools/**/*.test.ts'],
    environment: 'jsdom'
  }
});
