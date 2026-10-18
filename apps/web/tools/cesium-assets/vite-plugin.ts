import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath, type Plugin } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// 使用当前安装版本的发布资源，避免 JS 与 Worker 来自不同版本
const cesiumRoot = fileURLToPath(new URL('./Build/Cesium/', import.meta.resolve('cesium/package.json')));
const directories = ['Workers', 'ThirdParty', 'Assets', 'Widgets'] as const;

/** 收集目录内的相对文件名，顺序固定便于核对缺失和多余文件 */
function listFiles(directory: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...listFiles(resolve(directory, entry.name), `${name}/`));
    } else if (entry.isFile()) {
      files.push(name);
    } else {
      throw new Error(`[build-output] Cesium 静态资源包含非普通文件：${name}`);
    }
  }
  return files.sort();
}

/** 开发时提供静态文件，构建时在产物检查之前复制到 cesium 目录 */
export function cesiumAssetsPlugin(): Plugin[] {
  return viteStaticCopy({
    targets: directories.map(directory => ({
      src: normalizePath(resolve(cesiumRoot, directory)),
      dest: 'cesium'
    })),
    hook: 'writeBundle'
  });
}

/** 检查四个资源目录的完整文件清单和原始字节，不能只确认目录存在 */
export function checkCesiumAssets(outputDir: string): void {
  for (const directory of directories) {
    const source = resolve(cesiumRoot, directory);
    const output = resolve(outputDir, 'cesium', directory);
    if (!existsSync(source) || !existsSync(output)) {
      throw new Error(`[build-output] Cesium 静态资源目录缺失：${directory}`);
    }
    const sourceFiles = listFiles(source);
    const outputFiles = listFiles(output);
    if (
      sourceFiles.length === 0 ||
      sourceFiles.length !== outputFiles.length ||
      sourceFiles.some((name, index) => name !== outputFiles[index])
    ) {
      throw new Error(`[build-output] Cesium 静态资源文件清单不一致：${directory}`);
    }
    for (const name of sourceFiles) {
      if (!readFileSync(resolve(source, name)).equals(readFileSync(resolve(output, name)))) {
        throw new Error(`[build-output] Cesium 静态资源内容不一致：${directory}/${name}`);
      }
    }
  }
}
