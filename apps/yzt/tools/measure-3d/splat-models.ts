import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';

// 泼溅场景的模型从清单读（ADR 0149 L.3），和开发服务器同一个来源：本地清单在时用它（临时加不入库的模型）。
// 清单的完整校验在 features/scene-models/api.ts（依赖应用的别名，Node 里导入不了），这里只校验要用的字段

const placementSchema = z.object({ lng: z.number(), lat: z.number(), height: z.number(), heading: z.number() });
const splatSchema = z.object({ id: z.string(), kind: z.literal('splat'), lcc2: z.string().min(1), placement: placementSchema });
const manifestSchema = z.object({ models: z.array(z.looseObject({ id: z.string() })) });

export type SplatPlacement = z.infer<typeof placementSchema>;

export interface SplatModel {
  readonly id: string;
  /** 相对 /3dt/ 的索引地址，和清单里一样按 URL 编码 */
  readonly path: string;
  readonly placement: SplatPlacement;
}

/** 清单从哪里来：设了 YZT_3DT_PROXY 时从服务器取，本地清单在时用它，否则用入库的那份 */
export type ManifestSource =
  | { readonly kind: 'proxy'; readonly url: string }
  | { readonly kind: 'local'; readonly file: string }
  | { readonly kind: 'public'; readonly file: string };

/** 和开发服务器的选法相同（docs/config/local-files.md）：local/3dt/manifest.json 盖住入库的清单，设了代理时两者都不用 */
export function manifestSource(localFile: string, publicFile: string, proxy: string | null, exists = existsSync): ManifestSource {
  if (proxy) {
    return { kind: 'proxy', url: new URL('/3dt/manifest.json', proxy).href };
  }
  return exists(localFile) ? { kind: 'local', file: localFile } : { kind: 'public', file: publicFile };
}

/** 读清单的内容；文件开头的 BOM 去掉（PowerShell 写的 UTF-8 带 BOM） */
export async function readManifest(source: ManifestSource): Promise<unknown> {
  if (source.kind === 'proxy') {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      throw new Error(`取不到清单 ${source.url}：HTTP ${response.status}`);
    }
    return response.json();
  }
  return JSON.parse(readFileSync(source.file, 'utf8').replace(/^\uFEFF/, ''));
}

/** 写进结果的说明：结果可能带到别处，服务器的地址不写进去 */
export function manifestLabel(source: ManifestSource): string {
  if (source.kind === 'proxy') {
    return '服务器上的清单（YZT_3DT_PROXY）';
  }
  return source.kind === 'local' ? '本地清单 local/3dt/manifest.json' : '入库的清单 public/3dt/manifest.json';
}

// 清单里的地址相对清单（/3dt/manifest.json）；测量的服务只提供 /3dt/ 下的文件
function pathUnder3dt(id: string, lcc2: string): string {
  const { pathname, origin } = new URL(lcc2, 'http://manifest.invalid/3dt/manifest.json');
  if (origin !== 'http://manifest.invalid' || !pathname.startsWith('/3dt/')) {
    throw new Error(`清单里 ${id} 的 lcc2 不在 /3dt/ 下：${lcc2}`);
  }
  return pathname.slice('/3dt/'.length);
}

/** 按 ID 取出泼溅模型；缺的、不是泼溅的、字段不对的都抛出说明 */
export function resolveSplats(manifest: unknown, ids: readonly string[]): SplatModel[] {
  const parsed = manifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new Error('清单的格式不对：要有 models 数组，每个模型有 id');
  }
  return ids.map(id => {
    const model = parsed.data.models.find(item => item.id === id);
    if (!model) {
      throw new Error(`清单里没有 ${id}`);
    }
    const splat = splatSchema.safeParse(model);
    if (!splat.success) {
      throw new Error(`清单里的 ${id} 不是高斯泼溅，或者缺 lcc2、placement`);
    }
    const { lcc2, placement } = splat.data;
    return { id, path: pathUnder3dt(id, lcc2), placement };
  });
}

/** 磁盘上的相对路径：清单里按 URL 编码 */
export const decodedPath = (path: string) => decodeURIComponent(path);
