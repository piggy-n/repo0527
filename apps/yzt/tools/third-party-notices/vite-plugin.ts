import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePath, type Plugin } from 'vite';

/**
 * 带 NOTICE 的包打进产物时要随附的文件，路径相对包的根目录：NOTICE、LICENSE 和两者指向的文件。
 * 只管带 NOTICE 的包，其余依赖的许可不在这里（docs/config/vite-config.md"第三方许可"）
 */
export const NOTICE_PACKAGES: Readonly<Record<string, readonly string[]>> = {
  echarts: ['LICENSE', 'NOTICE', 'licenses/LICENSE-d3'],
  'gaussian-splat-lite': ['LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES.md']
};

export interface NoticeFile {
  /** 产物里的路径，如 licenses/echarts/NOTICE */
  fileName: string;
  source: string;
}

// 最后一个 node_modules 之后是模块所在的包：包的根目录和包名（含 scope）
const PACKAGE_PATH = /^(.*\/node_modules\/((?:@[^/]+\/)?[^/]+))\//;

function packageVersion(root: string): string {
  const data: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (typeof data !== 'object' || data === null || !('version' in data) || typeof data.version !== 'string') {
    throw new Error(`[third-party-notices] ${root} 的 package.json 没有 version`);
  }
  return data.version;
}

/** 按产物里的模块找出要随附的许可文件；带 NOTICE 的包不在清单里、清单里的文件不存在、清单里的包打进了两个版本时抛错 */
export function collectNotices(
  moduleIds: Iterable<string>,
  packages: Readonly<Record<string, readonly string[]>> = NOTICE_PACKAGES
): NoticeFile[] {
  // 按根目录去重：pnpm 会并排装同一个包的几个版本，每个都要检查
  const roots = new Map<string, string>();
  for (const id of moduleIds) {
    // 插件生成的模块以 \0 开头，后面仍可能是真实路径
    const match = PACKAGE_PATH.exec(normalizePath(id.replace(/^\0/, '')));
    if (match) {
      roots.set(match[1], match[2]);
    }
  }
  const files: NoticeFile[] = [];
  const shipped = new Map<string, string>();
  for (const [root, name] of [...roots].toSorted(([a, x], [b, y]) => x.localeCompare(y) || a.localeCompare(b))) {
    const listed = packages[name];
    if (!listed) {
      if (readdirSync(root).some(file => /^notice(?:\.|$)/i.test(file))) {
        throw new Error(`[third-party-notices] 产物包含带 NOTICE 的 ${name}，要在 NOTICE_PACKAGES 里列出随附的文件`);
      }
      continue;
    }
    // 同一版本的几个根目录（peer 依赖不同）内容一样，只带一份；不同版本放不进同一个目录
    const version = packageVersion(root);
    const previous = shipped.get(name);
    if (previous !== undefined) {
      if (previous !== version) {
        throw new Error(`[third-party-notices] 产物包含 ${name} 的两个版本（${previous}、${version}），licenses/${name}/ 只能放一份`);
      }
      continue;
    }
    shipped.set(name, version);
    for (const path of listed) {
      const source = join(root, path);
      if (!existsSync(source)) {
        throw new Error(`[third-party-notices] ${name} 里没有 ${path}，升级后核对 NOTICE_PACKAGES`);
      }
      files.push({ fileName: `licenses/${name}/${path}`, source: readFileSync(source, 'utf8') });
    }
  }
  return files;
}

/** 构建时把产物里用到的、带 NOTICE 的包的许可文件放到 licenses/<包名>/，内容取自安装的版本 */
export function thirdPartyNoticesPlugin(packages = NOTICE_PACKAGES): Plugin {
  return {
    name: 'yzt:third-party-notices',
    apply: 'build',
    generateBundle(_, bundle) {
      const moduleIds = Object.values(bundle).flatMap(item => (item.type === 'chunk' ? item.moduleIds : []));
      for (const { fileName, source } of collectNotices(moduleIds, packages)) {
        this.emitFile({ type: 'asset', fileName, source });
      }
    }
  };
}
