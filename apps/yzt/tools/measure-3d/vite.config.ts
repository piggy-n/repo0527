import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const here = import.meta.dirname;

/** 页面的产物目录：在 node_modules 下，不入库，也不和应用的 dist 混在一起 */
export const PAGE_OUT_DIR = resolve(here, '../../node_modules/.cache/measure-3d');

// 按包分块：CPU 采样按分块归因（profile.ts），才知道时间花在 three、maplibre-gl 还是 cesium
function packageChunk(id: string): string | undefined {
  const normalized = id.replaceAll('\\', '/');
  const workspace = /\/packages\/([^/]+)\/src\//.exec(normalized);
  if (workspace) {
    return workspace[1];
  }
  const dependency = /\/node_modules\/\.pnpm\/[^/]+\/node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(normalized);
  return dependency?.[1]?.replace('/', '_');
}

// 测量页的构建（ADR 0147 第 7 节）：生产模式、压缩，和应用用同一套包；开发服务器逐个加载模块，长任务会失真。
// 按包分块和应用的分块不同，只影响加载时分几个文件，不影响运行的代码
export default defineConfig({
  root: resolve(here, 'page'),
  base: '/',
  logLevel: 'warn',
  publicDir: false,
  worker: { format: 'es' },
  build: {
    outDir: PAGE_OUT_DIR,
    emptyOutDir: true,
    target: 'esnext',
    chunkSizeWarningLimit: 100000,
    rolldownOptions: {
      input: {
        bench: resolve(here, 'page/index.html'),
        compare: resolve(here, 'page/compare.html')
      },
      // 下面关掉"连依赖一起放进分块"时，rolldown 要求这两项，否则可能生成顺序不对的分块；探针也靠它最先执行
      preserveEntrySignatures: false,
      output: {
        strictExecutionOrder: true,
        codeSplitting: {
          // 默认会把依赖也放进同一个分块：实测 maplibre-gl 跑进了 map-cesium，three 跑进了 3d-tiles-renderer，归因的名字全错
          includeDependenciesRecursively: false,
          groups: [{ name: id => packageChunk(id) ?? null, debugName: 'packages' }]
        }
      }
    }
  }
});
