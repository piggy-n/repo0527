// MapLibre 读 ArcGIS 紧凑缓存的自定义协议（ADR 0165 第 3 节）：协议对整个页面生效，由 app 用 addProtocol 注册一次
import type { CompactTileReader } from '../tiles/arcgis-compact';

/** 协议名：数据源的瓦片地址以 `arcgis-compact://` 开头 */
export const COMPACT_TILE_PROTOCOL = 'arcgis-compact';

const PREFIX = `${COMPACT_TILE_PROTOCOL}://`;
// 缓存根目录：http(s) 的绝对地址，以 / 结尾，不带查询和锚点
const ROOT = /^https?:\/\/[^/?#{}]+\/(?:[^?#{}]*\/)?$/;
const TILE_URL = /^(https?:\/\/.+\/)(\d+)\/(\d+)\/(\d+)$/;

/** 处理函数：结构上和 maplibre-gl 的 AddProtocolAction 兼容，可以直接交给 addProtocol */
export type CompactTileProtocol = (
  request: { readonly url: string },
  abortController: AbortController
) => Promise<{ data: ArrayBuffer }>;

/** 栅格数据源的瓦片地址模板：root 是缓存的 `Layers/` 目录的绝对地址，以 / 结尾 */
export function compactTileTemplate(root: string): string {
  if (!ROOT.test(root)) {
    throw new Error(`缓存的地址要是 http(s) 的绝对地址并以 / 结尾：${root}`);
  }
  return `${PREFIX}${root}{z}/{x}/{y}`;
}

function notFound(url: string): Error {
  // 要是 Error 的实例：MapLibre 会把别的值重新包一层，status 就丢了
  return Object.assign(new Error(`没有这块瓦片：${url}`), { status: 404 });
}

/**
 * 把读取器包成协议的处理函数：空瓦片和整块没有时以 status 为 404 的 Error 结束（MapLibre 不报错、改用上一级的瓦片），
 * 读取失败时以别的错误结束；跟着瓦片的取消信号；不返回缓存头，免得 MapLibre 定时重新加载
 */
export function createCompactTileProtocol(reader: CompactTileReader): CompactTileProtocol {
  return async ({ url }, abortController) => {
    const tile = url.startsWith(PREFIX) ? TILE_URL.exec(url.slice(PREFIX.length)) : null;
    if (!tile) {
      throw new Error(`不是紧凑缓存的瓦片地址：${url}`);
    }
    const [, root, z, x, y] = tile;
    const result = await reader.read(root, Number(z), Number(x), Number(y), abortController.signal);
    if (!result) {
      throw notFound(url);
    }
    return { data: result.data };
  };
}
