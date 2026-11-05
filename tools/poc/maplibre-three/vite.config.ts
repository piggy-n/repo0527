import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { createFileHandler } from './tools/lib/file-server.mjs';
import { CESIUM_RUNTIME_DIR, MODELS_DIR, POC_DIR, REPO_ROOT, ROAM_DIR } from './tools/lib/paths.mjs';

// 和主应用一样把 /3dt/* 映射到本地模型目录，/roam/* 映射到 apps/yzt/public/roam
const handle = createFileHandler({
  '/3dt/': MODELS_DIR,
  '/roam/': ROAM_DIR,
  '/cesium/': CESIUM_RUNTIME_DIR
});

function localFiles(): Plugin {
  return {
    name: 'poc-local-files',
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    }
  };
}

// 每个依赖单独成块，构建后直接比较压缩前后的大小，long animation frame 的归因也能看出是哪个库
function vendorChunk(id: string): string | undefined {
  const match = /node_modules[\\/]\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id);
  if (!match) {
    return undefined;
  }
  const name = match[1].replace(/[\\/]/g, '_');
  return `v-${name}`;
}

export default defineConfig({
  plugins: [localFiles()],
  // 对照组直接用 packages/map-cesium 的源码，cesium 一律从 PoC 自己的依赖解析，不要求安装整个仓库
  resolve: { dedupe: ['cesium'] },
  server: { port: 5273, strictPort: true, fs: { allow: [REPO_ROOT] } },
  preview: { port: 5273, strictPort: true },
  optimizeDeps: {
    include: ['maplibre-gl', 'three', '3d-tiles-renderer', '3d-tiles-renderer/core', '3d-tiles-renderer/plugins', 'maplibre-gl-three']
  },
  worker: { format: 'es' },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 100000,
    rollupOptions: {
      input: {
        main: resolve(POC_DIR, 'index.html'),
        roam: resolve(POC_DIR, 'roam.html'),
        benchC: resolve(POC_DIR, 'bench-c.html'),
        benchCesium: resolve(POC_DIR, 'bench-cesium.html'),
        manual: resolve(POC_DIR, 'manual.html')
      },
      output: { manualChunks: vendorChunk }
    }
  }
});
