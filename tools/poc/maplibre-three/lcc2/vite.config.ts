import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { createFileHandler } from '../tools/lib/file-server.mjs';
import { LCC2_DIR, LCC_APP_DIR, MODELS_DIR, REPO_ROOT } from '../tools/lib/paths.mjs';

// 样例只读：地址和磁盘路径一一对应，不复制
const handle = createFileHandler({
  '/lcc2/': LCC2_DIR,
  '/3dt/': MODELS_DIR
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
  server: { port: 5273, strictPort: true, fs: { allow: [REPO_ROOT] } },
  preview: { port: 5273, strictPort: true },
  worker: { format: 'es' },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 100000,
    rollupOptions: {
      input: { standalone: resolve(LCC_APP_DIR, 'index.html'), map: resolve(LCC_APP_DIR, 'map.html') },
      output: { manualChunks: vendorChunk }
    }
  }
});
