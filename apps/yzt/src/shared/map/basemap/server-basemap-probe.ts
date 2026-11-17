import { type CompactFetch, type CompactTile, createCompactTileReader } from '@mx/map-core';
import { safeReporter } from '@mx/utils';
import {
  SERVER_BASEMAP_OPTIONS,
  SERVER_BASEMAP_PROBE_TILE,
  SERVER_BASEMAP_PROBE_TIMEOUT,
  type ServerBasemapId,
  type ServerBasemapOption
} from '../../config/server-basemap-options';
import type { ServerBasemap, ServerBasemaps } from './server-basemaps';

// 探测服务器底图（ADR 0165 第 4 节）：导入 map-core 的读取器，只能由地图页的加载函数动态导入，maplibre-gl 才不进入口包

export interface ServerBasemapProbeOptions {
  /** 默认是全局的 fetch */
  readonly fetch?: CompactFetch;
  /** 一套底图的缓存根目录（绝对地址，以 / 结尾），默认 serverBasemapRoot */
  readonly root?: (prefix: string) => string;
  /** 总共最多等多久（毫秒） */
  readonly timeout?: number;
  /** 有要警告的失败时调用一次，默认 console.warn */
  readonly warn?: (failures: readonly ServerBasemapFailure[]) => void;
}

/** 要警告的读取失败：网络错误、超时、5xx；404、回落成网页不算，没有这些底图的服务器本来就会这样 */
export interface ServerBasemapFailure {
  readonly id: ServerBasemapId;
  readonly reason: string;
  readonly error: unknown;
}

type Outcome =
  | { readonly kind: 'present'; readonly basemap: ServerBasemap }
  | { readonly kind: 'absent' }
  | { readonly kind: 'failed'; readonly failure: ServerBasemapFailure };

const ABSENT: Outcome = { kind: 'absent' };

// String.fromCharCode 一次的参数个数上限以内
const BASE64_CHUNK = 0x8000;

/** 一套服务器底图的缓存根目录：`<BASE_URL>basemap/<prefix>/` 的绝对地址（自定义协议的地址模板要绝对地址） */
export function serverBasemapRoot(
  prefix: string,
  base: string = import.meta.env.BASE_URL,
  origin: string = location.origin
): string {
  return new URL(`${base}basemap/${prefix}/`, origin).href;
}

/** 瓦片的字节做成 data URL，类型按读到的格式 */
export function tileDataUrl({ data, type }: CompactTile): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + BASE64_CHUNK));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

const defaultWarn = (failures: readonly ServerBasemapFailure[]) => {
  console.warn('[basemap] 读不到服务器底图，这次浏览不显示它们，刷新重试', failures);
};

/**
 * 探测这台服务器有哪几套服务器底图：每套用读取器读南京那块缩略图瓦片，并行，总共最多等 timeout；读到图片才算有。
 * 不拒绝，任何错误都只是少几种底图；网络错误、超时、5xx 合起来记一条警告，404 和回落成网页不记
 */
export async function probeServerBasemaps(options: ServerBasemapProbeOptions = {}): Promise<ServerBasemaps> {
  const {
    fetch: fetchFn = (url, init) => fetch(url, init),
    root = serverBasemapRoot,
    timeout = SERVER_BASEMAP_PROBE_TIMEOUT,
    warn = defaultWarn
  } = options;
  const report = safeReporter(warn, 'basemap');
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException(`探测服务器底图超过 ${timeout} 毫秒`, 'TimeoutError')),
    timeout
  );

  // 一套底图的结果：读取器自己的错误分不出是不是服务器的问题，所以在它用的 fetch 上记下网络错误和 5xx
  async function probe(option: ServerBasemapOption): Promise<Outcome> {
    // 闭包里改的值放进数组，免得被收窄成 null
    const problems: string[] = [];
    const observed: CompactFetch = async (url, init) => {
      try {
        const response = await fetchFn(url, init);
        if (response.status >= 500) {
          problems.push(`HTTP ${response.status}`);
        }
        return response;
      } catch (error) {
        if (!init.signal?.aborted) {
          problems.push('网络错误');
        }
        throw error;
      }
    };
    try {
      const basemapRoot = root(option.prefix);
      // 共用的索引请求有自己的超时，和探测的一样长，探测结束后不会一直挂着
      const reader = createCompactTileReader({ fetch: observed, indexTimeout: timeout });
      const { z, x, y } = SERVER_BASEMAP_PROBE_TILE;
      const tile = await reader.read(basemapRoot, z, x, y, controller.signal);
      if (!tile) {
        return ABSENT;
      }
      return { kind: 'present', basemap: { id: option.id, root: basemapRoot, thumbnail: tileDataUrl(tile) } };
    } catch (error) {
      const timedOut = controller.signal.aborted || (error instanceof DOMException && error.name === 'TimeoutError');
      const reason = timedOut ? '超时' : problems.at(0);
      return reason === undefined ? ABSENT : { kind: 'failed', failure: { id: option.id, reason, error } };
    }
  }

  // probe 把所有错误都变成结果，这里不会拒绝
  const outcomes = await Promise.all(SERVER_BASEMAP_OPTIONS.map(probe));
  clearTimeout(timer);
  const failures = outcomes.flatMap(outcome => (outcome.kind === 'failed' ? [outcome.failure] : []));
  if (failures.length > 0) {
    report(failures);
  }
  return outcomes.flatMap(outcome => (outcome.kind === 'present' ? [outcome.basemap] : []));
}
