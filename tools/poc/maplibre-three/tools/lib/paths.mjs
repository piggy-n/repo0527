// PoC 用到的目录：放在 local/poc/maplibre-three 和 tools/poc/maplibre-three 都一样，只依赖离仓库根的层级
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const POC_DIR = resolve(here, '../..');
export const LCC_APP_DIR = join(POC_DIR, 'lcc2');
export const REPO_ROOT = resolve(POC_DIR, '../../..');

// 和主应用相同：YZT_LOCAL_DIR 可以指到别处，默认是仓库根的 local
export const LOCAL_DIR = process.env.YZT_LOCAL_DIR ? resolve(process.env.YZT_LOCAL_DIR) : join(REPO_ROOT, 'local');
export const MODELS_DIR = join(LOCAL_DIR, '3dt');
export const LCC2_DIR = process.env.LCC2_DIR ? resolve(process.env.LCC2_DIR) : join(LOCAL_DIR, 'lcc2', 'render2');
export const ROAM_DIR = join(REPO_ROOT, 'apps', 'yzt', 'public', 'roam');
export const CESIUM_RUNTIME_DIR = join(POC_DIR, 'node_modules', 'cesium', 'Build', 'Cesium');
// LCC2 工程自己装了一份 Cesium（叠画布的页面用），运行时文件从它那里取
export const LCC_CESIUM_RUNTIME_DIR = join(LCC_APP_DIR, 'node_modules', 'cesium', 'Build', 'Cesium');

/** 样例目录里的 .lcc2 索引文件名；目录不存在时返回空数组 */
export function listLccFiles() {
  if (!existsSync(LCC2_DIR)) {
    return [];
  }
  return readdirSync(LCC2_DIR).filter(name => name.toLowerCase().endsWith('.lcc2'));
}
