import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { createFileHandler } from '../tools/lib/file-server.mjs';
import { LCC2_DIR, LCC_APP_DIR, LCC_CESIUM_RUNTIME_DIR, MODELS_DIR, REPO_ROOT } from '../tools/lib/paths.mjs';

// 样例只读：地址和磁盘路径一一对应，不复制
const handle = createFileHandler({
  '/lcc2/': LCC2_DIR,
  '/3dt/': MODELS_DIR,
  '/cesium/': LCC_CESIUM_RUNTIME_DIR
});

function localFiles(): Plugin {
  return {
    name: 'poc-lcc2-files',
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    }
  };
}

function vendorChunk(id: string): string | undefined {
  const match = /node_modules[\\/]\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id);
  return match ? `v-${match[1].replace(/[\\/]/g, '_')}` : undefined;
}

export default defineConfig({
  plugins: [localFiles()],
  // 叠画布的页面直接用 packages/map-cesium 的源码，cesium 一律从这个工程的依赖解析
  resolve: { dedupe: ['cesium'] },
  server: { port: 5273, strictPort: true, fs: { allow: [REPO_ROOT] } },
  preview: { port: 5273, strictPort: true },
  worker: { format: 'es' },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 100000,
    rollupOptions: {
      input: {
        standalone: resolve(LCC_APP_DIR, 'index.html'),
        map: resolve(LCC_APP_DIR, 'map.html'),
        cesium: resolve(LCC_APP_DIR, 'cesium.html')
      },
      output: { manualChunks: vendorChunk }
    }
  }
});
