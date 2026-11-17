// ArcGIS 第一代紧凑缓存（Compact V1）的读取（ADR 0165 第 3 节）：不依赖框架和 MapLibre，fetch 由参数传入
import { abortReason } from '@mx/utils';

// 每个 bundle 是 128 × 128 块
const PACKET = 128;
const SLOTS = PACKET * PACKET;
// .bundlx：16 字节头 + 每块 5 字节的偏移 + 16 字节尾
const INDEX_HEADER = 16;
const ENTRY_BYTES = 5;
const INDEX_MAGIC = [0x03, 0, 0, 0, 0x10, 0, 0, 0, 0, 0x40, 0, 0, 0x05, 0, 0, 0];
// .bundle 的头 60 字节 + 16384 × 4 字节的占位区：小于它的偏移都是空槽（ArcGIS 写 60+4i，别的工具删除时写 0）
const DATA_START = 60 + SLOTS * 4;
// 一块瓦片一次最多读这么多（够装一块 256 像素的 PNG32），记录更长时再补读一次
const RANGE_LIMIT = 256 * 1024;
// 记录的长度超过它就当作读错了位置
const MAX_TILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_INDEX_TIMEOUT = 10_000;
// 每个索引最多约 256 KB
const DEFAULT_MAX_INDEXES = 32;

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** .bundlx 的字节数 */
export const COMPACT_INDEX_BYTES = INDEX_HEADER + SLOTS * ENTRY_BYTES + 16;

/** 瓦片在缓存里的位置：bundle 相对缓存根目录（`Layers/`）的路径，不带扩展名；索引里的槽号 */
export interface CompactTileLocation {
  readonly bundle: string;
  readonly slot: number;
}

/** 解析后的 .bundlx */
export interface CompactIndex {
  /** 每个槽的瓦片记录在 .bundle 里的偏移；小于 65596 的是空槽 */
  readonly offsets: Float64Array;
  /** 去重、升序的有效偏移，用来找一条记录读到哪里为止 */
  readonly live: Float64Array;
}

export type TileImageType = 'image/jpeg' | 'image/png';

/** 读到的一块瓦片：编码后的图片字节 */
export interface CompactTile {
  readonly data: ArrayBuffer;
  readonly type: TileImageType;
}

export type CompactFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface CompactTileReaderOptions {
  /** 默认是全局的 fetch */
  readonly fetch?: CompactFetch;
  /** 读一个 .bundlx 最多等多久（毫秒），默认 10 秒 */
  readonly indexTimeout?: number;
  /** 最多缓存几个 bundle 的索引（包括"整块没有"），默认 32 */
  readonly maxIndexes?: number;
}

export interface CompactTileReader {
  /**
   * 读一块瓦片：root 是缓存的 `Layers/` 目录的地址，以 `/` 结尾。空槽或整块没有时为 null，读取失败时抛错；
   * signal 中止时以它的原因结束
   */
  read(root: string, z: number, x: number, y: number, signal?: AbortSignal): Promise<CompactTile | null>;
}

const hex = (value: number) => value.toString(16).padStart(4, '0');

/** 瓦片号（XYZ，行号自上而下，同 ArcGIS）换算成 bundle 和槽号：行列取 128 的倍数写成至少 4 位的小写十六进制，槽按列存 */
export function compactTileLocation(z: number, x: number, y: number): CompactTileLocation {
  const size = 2 ** z;
  const valid =
    Number.isInteger(z) &&
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    z >= 0 &&
    z <= 30 &&
    x >= 0 &&
    y >= 0 &&
    x < size &&
    y < size;
  if (!valid) {
    throw new RangeError(`瓦片号不合法：${z}/${x}/${y}`);
  }
  const row = y - (y % PACKET);
  const column = x - (x % PACKET);
  return {
    bundle: `_alllayers/L${String(z).padStart(2, '0')}/R${hex(row)}C${hex(column)}`,
    slot: PACKET * (x - column) + (y - row)
  };
}

/** 解析 .bundlx：长度和文件头不对时抛错（比如回落成了网页） */
export function parseCompactIndex(bytes: Uint8Array): CompactIndex {
  if (bytes.length !== COMPACT_INDEX_BYTES) {
    throw new Error(`不是紧凑缓存的索引：${bytes.length} 字节，应为 ${COMPACT_INDEX_BYTES}`);
  }
  if (!startsWith(bytes, INDEX_MAGIC)) {
    throw new Error('不是第一代紧凑缓存的索引：文件头不对');
  }
  const offsets = new Float64Array(SLOTS);
  for (let slot = 0; slot < SLOTS; slot++) {
    const at = INDEX_HEADER + slot * ENTRY_BYTES;
    // 5 字节小端，超过 32 位，不能用位运算拼
    offsets[slot] =
      bytes[at] + bytes[at + 1] * 2 ** 8 + bytes[at + 2] * 2 ** 16 + bytes[at + 3] * 2 ** 24 + bytes[at + 4] * 2 ** 32;
  }
  const live = Float64Array.from(new Set(offsets.filter(offset => offset >= DATA_START))).toSorted();
  return { offsets, live };
}

/** 按开头的字节认图片格式：JPEG、PNG 以外的为 null */
export function tileImageType(bytes: Uint8Array): TileImageType | null {
  if (startsWith(bytes, JPEG_MAGIC)) {
    return 'image/jpeg';
  }
  if (startsWith(bytes, PNG_MAGIC)) {
    return 'image/png';
  }
  return null;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

// 比 offset 大的第一个有效偏移，没有时为 Infinity
function nextOffset(index: CompactIndex, offset: number): number {
  const { live } = index;
  let low = 0;
  let high = live.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (live[middle] <= offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low < live.length ? live[low] : Infinity;
}

// 索引和 .bundle 对不上（长度 0、不是图片、文件没了）：可能是文件被替换了，重读索引再试一次
class StaleRecordError extends Error {
  override name = 'StaleRecordError';
}

function ensureActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortReason(signal);
  }
}

// 几块瓦片共用的等待：各自按自己的 signal 提前结束，不影响共用的请求
function whileActive<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

// 不读的响应体立刻取消：Range 被忽略时是整个 bundle，可能有几百 MB
function discard(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+|\*)$/;

interface RangeBytes {
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** 文件的总长度，服务器没给时为 null */
  readonly total: number | null;
}

/** 读 ArcGIS 紧凑缓存的瓦片（ADR 0165 第 3 节）；索引按地址缓存、几块瓦片共用一个请求，有上限 */
export function createCompactTileReader(options: CompactTileReaderOptions = {}): CompactTileReader {
  const fetchFn: CompactFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const indexTimeout = options.indexTimeout ?? DEFAULT_INDEX_TIMEOUT;
  const maxIndexes = options.maxIndexes ?? DEFAULT_MAX_INDEXES;
  if (!(indexTimeout > 0) || !Number.isInteger(maxIndexes) || maxIndexes < 1) {
    throw new RangeError('indexTimeout 要大于 0，maxIndexes 要是正整数');
  }
  // 按地址缓存的索引请求，null 是整块没有（404）；Map 的顺序就是最近用过的顺序
  const indexes = new Map<string, Promise<CompactIndex | null>>();

  // 共用的请求不跟任何一块瓦片的 signal 走，用自己的超时
  async function fetchIndex(url: string, revalidate: boolean): Promise<CompactIndex | null> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException(`读取 ${url} 超过 ${indexTimeout} 毫秒`, 'TimeoutError')),
      indexTimeout
    );
    try {
      // 重读时向服务器确认，不直接用浏览器缓存里的旧索引
      const response = await fetchFn(url, { signal: controller.signal, cache: revalidate ? 'no-cache' : 'default' });
      if (response.status === 404) {
        discard(response);
        return null;
      }
      if (response.status !== 200) {
        discard(response);
        throw new Error(`读取 ${url} 失败：HTTP ${response.status}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      try {
        return parseCompactIndex(bytes);
      } catch (error) {
        throw new Error(`读取 ${url} 失败`, { cause: error });
      }
    } catch (error) {
      throw controller.signal.aborted ? abortReason(controller.signal) : error;
    } finally {
      clearTimeout(timer);
    }
  }

  function loadIndex(url: string, revalidate: boolean): Promise<CompactIndex | null> {
    const cached = indexes.get(url);
    if (cached) {
      indexes.delete(url);
      indexes.set(url, cached);
      return cached;
    }
    const loading = fetchIndex(url, revalidate);
    indexes.set(url, loading);
    // 失败的不留，下一块瓦片重新请求
    void loading.catch(() => {
      if (indexes.get(url) === loading) {
        indexes.delete(url);
      }
    });
    for (const oldest of indexes.keys()) {
      if (indexes.size <= maxIndexes) {
        break;
      }
      indexes.delete(oldest);
    }
    return loading;
  }

  async function fetchRange(url: string, start: number, end: number, signal?: AbortSignal): Promise<RangeBytes> {
    // Windows 上的 Chrome、Edge 用磁盘缓存回答同一文件的 Range 有过返回全零的故障，一律不缓存
    const response = await fetchFn(url, { headers: { Range: `bytes=${start}-${end}` }, cache: 'no-store', signal });
    if (signal?.aborted) {
      discard(response);
      throw abortReason(signal);
    }
    if (response.status === 404 || response.status === 416) {
      discard(response);
      throw new StaleRecordError(`读取 ${url} 失败：HTTP ${response.status}`);
    }
    if (response.status !== 206) {
      discard(response);
      throw new Error(
        response.status === 200
          ? `读取 ${url} 失败：服务器没有按 Range 返回部分内容`
          : `读取 ${url} 失败：HTTP ${response.status}`
      );
    }
    const header = response.headers.get('Content-Range') ?? '';
    const range = CONTENT_RANGE.exec(header);
    if (!range || Number(range[1]) !== start) {
      discard(response);
      throw new Error(`读取 ${url} 失败：请求从 ${start} 起，Content-Range 是"${header}"`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    ensureActive(signal);
    return { bytes, total: range[3] === '*' ? null : Number(range[3]) };
  }

  // 一个 Range 从偏移读到下一条有效记录之前：前 4 字节是长度，后面是图片
  async function readRecord(
    url: string,
    index: CompactIndex,
    offset: number,
    signal?: AbortSignal
  ): Promise<CompactTile> {
    const end = Math.min(nextOffset(index, offset), offset + RANGE_LIMIT);
    const head = await fetchRange(url, offset, end - 1, signal);
    const where = `${url} 在 ${offset} 处`;
    if (head.bytes.length < 4) {
      throw new StaleRecordError(`${where}只读到 ${head.bytes.length} 字节`);
    }
    const length = new DataView(head.bytes.buffer, head.bytes.byteOffset, 4).getUint32(0, true);
    if (length === 0) {
      throw new StaleRecordError(`${where}的瓦片长度是 0`);
    }
    if (length > MAX_TILE_BYTES || (head.total !== null && offset + 4 + length > head.total)) {
      throw new StaleRecordError(`${where}的瓦片长度 ${length} 超出文件`);
    }
    let data: Uint8Array<ArrayBuffer>;
    if (4 + length <= head.bytes.length) {
      data = head.bytes.slice(4, 4 + length);
    } else {
      // 记录比读到的长：补读缺的部分
      const missing = 4 + length - head.bytes.length;
      const rest = await fetchRange(url, offset + head.bytes.length, offset + 4 + length - 1, signal);
      if (rest.bytes.length < missing) {
        throw new StaleRecordError(`${where}的瓦片长度 ${length}，补读后仍不够`);
      }
      data = new Uint8Array(length);
      data.set(head.bytes.subarray(4));
      data.set(rest.bytes.subarray(0, missing), head.bytes.length - 4);
    }
    const type = tileImageType(data);
    if (!type) {
      throw new StaleRecordError(`${where}的数据不是 JPEG 或 PNG`);
    }
    return { data: data.buffer, type };
  }

  async function readSlot(
    loading: Promise<CompactIndex | null>,
    url: string,
    slot: number,
    signal?: AbortSignal
  ): Promise<CompactTile | null> {
    const index = await whileActive(loading, signal);
    if (!index) {
      return null;
    }
    const offset = index.offsets[slot];
    if (offset < DATA_START) {
      return null;
    }
    return readRecord(url, index, offset, signal);
  }

  return {
    async read(root, z, x, y, signal) {
      if (!root.endsWith('/')) {
        throw new Error(`缓存的地址要以 / 结尾：${root}`);
      }
      ensureActive(signal);
      const { bundle, slot } = compactTileLocation(z, x, y);
      const indexUrl = `${root}${bundle}.bundlx`;
      const dataUrl = `${root}${bundle}.bundle`;
      const first = loadIndex(indexUrl, false);
      try {
        return await readSlot(first, dataUrl, slot, signal);
      } catch (error) {
        if (!(error instanceof StaleRecordError)) {
          throw error;
        }
      }
      // 丢掉这个 bundle 的索引（别的瓦片已经换了新的就不动），向服务器确认后重读一次，还不对就报错
      if (indexes.get(indexUrl) === first) {
        indexes.delete(indexUrl);
      }
      return readSlot(loadIndex(indexUrl, true), dataUrl, slot, signal);
    }
  };
}
