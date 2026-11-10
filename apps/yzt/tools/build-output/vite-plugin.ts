import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv, normalizePath, type Plugin, type ResolvedConfig, type Rolldown } from 'vite';

// 地图引擎只能经由动态导入出现：二维的 MapLibre、三维的 Cesium（含拆出的 @cesium/* 包）和 Three.js（ADR 0147 第 7 节）
const MAP_ENGINES = [
  { name: 'MapLibre', path: '/node_modules/maplibre-gl/' },
  { name: 'Cesium', path: '/node_modules/cesium/' },
  { name: 'Cesium', path: '/node_modules/@cesium/' },
  { name: 'Three.js', path: '/node_modules/three/' },
  { name: '3d-tiles-renderer', path: '/node_modules/3d-tiles-renderer/' }
];

/** 只检查入口的静态依赖，地图运行时的动态导入不在此范围 */
function checkEntryImports(bundle: Rolldown.OutputBundle): void {
  const pending = Object.values(bundle).filter(item => item.type === 'chunk' && item.isEntry);
  const visited = new Set<string>();
  while (pending.length > 0) {
    const chunk = pending.pop();
    if (!chunk || chunk.type !== 'chunk' || visited.has(chunk.fileName)) {
      continue;
    }
    visited.add(chunk.fileName);
    const engine = MAP_ENGINES.find(({ path }) => chunk.moduleIds.some(id => normalizePath(id).includes(path)));
    if (engine) {
      throw new Error(`[build-output] 入口静态依赖包含 ${engine.name}：${chunk.fileName}`);
    }
    for (const name of chunk.imports) {
      const dependency = bundle[name];
      if (dependency?.type === 'chunk') {
        pending.push(dependency);
      }
    }
  }
}

/** 检查磁盘上的实际产物，也覆盖 public 中原样复制的文件 */
function checkFiles(directory: string, keys: readonly string[], prefix = ''): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    const path = resolve(directory, entry.name);
    if (entry.name === 'design.local' || /^Dev.*Page(?:-|\.)/.test(entry.name)) {
      throw new Error(`[build-output] 产物包含开发专用文件：${name}（原型放在 local/design，见 ADR 0141）`);
    }
    if (prefix === '3dt/' && entry.name !== 'manifest.json') {
      throw new Error(`[build-output] 产物包含 3DT 模型数据：${name}（模型放在 local/3dt，见 ADR 0141）`);
    }
    if (entry.isDirectory()) {
      checkFiles(path, keys, `${name}/`);
    } else if (keys.length > 0 && /\.(?:[cm]?js|css|html|json|map|svg|txt)$/i.test(entry.name)) {
      const content = readFileSync(path, 'utf8');
      if (keys.some(key => content.includes(key))) {
        // 只报告文件名，不把 key 写进日志
        throw new Error(`[build-output] 关闭天地图的产物仍包含 key：${name}`);
      }
    }
  }
}

/** 构建完成时检查产物：没有开发页、本地设计稿和 3DT 模型数据，入口依赖不含地图引擎，关闭天地图时没有 key */
export function buildOutputPlugin(): Plugin {
  let config: ResolvedConfig;
  let forbiddenKeys: string[] = [];

  return {
    name: 'yzt:build-output',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
      if (config.env.VITE_TIANDITU_ENABLED === 'false') {
        if (config.env.VITE_TIANDITU_KEY) {
          throw new Error('[build-output] 关闭天地图时必须同时清空 VITE_TIANDITU_KEY');
        }
        // 公网配置的 key 不应出现在内网文件中，包括从 public 复制的文件
        const publicKey = loadEnv('production', config.envDir, 'VITE_TIANDITU_').VITE_TIANDITU_KEY;
        forbiddenKeys = publicKey ? [publicKey] : [];
      }
    },
    writeBundle: {
      order: 'post',
      sequential: true,
      handler(options, bundle) {
        const outputDir = resolve(config.root, options.dir ?? config.build.outDir);
        const devPages = `${normalizePath(resolve(config.root, 'src/pages/dev'))}/`;
        for (const item of Object.values(bundle)) {
          if (item.type === 'chunk' && item.moduleIds.some(id => normalizePath(id).startsWith(devPages))) {
            throw new Error(`[build-output] 产物包含开发页面：${item.fileName}`);
          }
        }
        checkEntryImports(bundle);
        checkFiles(outputDir, forbiddenKeys);
        config.logger.info('[build-output] 产物检查通过');
      }
    }
  };
}
