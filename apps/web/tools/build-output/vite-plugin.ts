import { existsSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { loadEnv, normalizePath, type Plugin, type ResolvedConfig, type Rolldown } from 'vite';

/** 判断目标是否在目录内，包含目录自身 */
function contains(directory: string, target: string): boolean {
  const path = relative(directory, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

// 地图引擎只能经由动态导入出现：二维的 MapLibre、三维的 Cesium（含拆出的 @cesium/* 包）
const MAP_ENGINES = [
  { name: 'MapLibre', path: '/node_modules/maplibre-gl/' },
  { name: 'Cesium', path: '/node_modules/cesium/' },
  { name: 'Cesium', path: '/node_modules/@cesium/' }
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
      throw new Error(`[build-output] 产物包含开发专用文件：${name}`);
    }
    if (prefix === '3dt/' && entry.name !== 'manifest.json') {
      throw new Error(`[build-output] 产物包含 3DT 模型数据：${name}`);
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

/** 构建完成时清理本地设计稿和 3DT 模型数据，并检查开发页、入口依赖和关闭天地图时的 key */
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
        const outputDir = realpathSync(resolve(config.root, options.dir ?? config.build.outDir));
        const root = realpathSync(config.root);
        const publicDir = config.publicDir && existsSync(config.publicDir) ? realpathSync(config.publicDir) : null;
        // 删除前确认输出目录与源码、public 分开，目标只能是该输出目录内的副本
        if (
          contains(outputDir, root) ||
          (publicDir && (contains(publicDir, outputDir) || contains(outputDir, publicDir)))
        ) {
          throw new Error('[build-output] 输出目录与源码或 public 重叠，不能清理设计稿和模型数据');
        }
        const designs = resolve(outputDir, 'design.local');
        if (relative(outputDir, designs) !== 'design.local') {
          throw new Error('[build-output] 设计稿清理路径不在输出目录内');
        }
        rmSync(designs, { recursive: true, force: true });

        // 3DT 模型数据在服务器上单独部署，产物只留随代码发布的清单（docs/deployment.md）
        const models = resolve(outputDir, '3dt');
        if (existsSync(models)) {
          for (const name of readdirSync(models)) {
            if (name !== 'manifest.json') {
              rmSync(resolve(models, name), { recursive: true, force: true });
            }
          }
        }

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
