import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePath, type Plugin } from 'vite';

/** 打进产物时要随附的文件，路径相对包的根目录：Apache-2.0 要带 LICENSE 和 NOTICE，NOTICE、LICENSE 里指向的第三方许可一起带 */
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

/** 按产物里的模块找出要随附的许可文件；带 NOTICE 的包不在清单里、清单里的文件不存在时抛错 */
export function collectNotices(
  moduleIds: Iterable<string>,
  packages: Readonly<Record<string, readonly string[]>> = NOTICE_PACKAGES
): NoticeFile[] {
  const roots = new Map<string, string>();
  for (const id of moduleIds) {
    // 插件生成的模块以 \0 开头，后面仍可能是真实路径
    const match = PACKAGE_PATH.exec(normalizePath(id.replace(/^\0/, '')));
    if (match && !roots.has(match[2])) {
      roots.set(match[2], match[1]);
    }
  }
  const files: NoticeFile[] = [];
  for (const [name, root] of [...roots].toSorted(([a], [b]) => a.localeCompare(b))) {
    const listed = packages[name];
    if (!listed) {
      if (readdirSync(root).some(file => /^notice(?:\.|$)/i.test(file))) {
        throw new Error(`[third-party-notices] 产物包含带 NOTICE 的 ${name}，要在 NOTICE_PACKAGES 里列出随附的文件`);
      }
      continue;
    }
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
export function thirdPartyNoticesPlugin(): Plugin {
  return {
    name: 'yzt:third-party-notices',
    apply: 'build',
    generateBundle(_, bundle) {
      const moduleIds = Object.values(bundle).flatMap(item => (item.type === 'chunk' ? item.moduleIds : []));
      for (const { fileName, source } of collectNotices(moduleIds)) {
        this.emitFile({ type: 'asset', fileName, source });
      }
    }
  };
}
