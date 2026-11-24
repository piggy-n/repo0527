// 天地图的三维地形（ADR 0170）：浏览器直接读、换成 MapLibre 的 raster-dem，不经服务器转换。
// 格式来自天地图官方 Cesium 插件的解码代码（三份开源实现一致，见 docs/modules/map-core.md"天地图地形"）：
// 经纬度分块，l 级每块 360/2^l 度，原点在 (-180, 90)、y 向下；每块是 zlib 压缩的 150×150 个小端 int16（米），
// 行优先、第 0 行在北，首末两行、两列在瓦片的边上（和相邻的瓦片共用）
import { abortReason } from '@mx/utils';

/** 一块瓦片每边的采样个数 */
export const TIANDITU_TERRAIN_SAMPLES = 150;
/** 有数据的级别：官方插件 6 级以下不请求，12 级以上没有数据（约 65 米一个点） */
export const TIANDITU_TERRAIN_MIN_LEVEL = 6;
export const TIANDITU_TERRAIN_MAX_LEVEL = 12;

const CELLS = TIANDITU_TERRAIN_SAMPLES - 1;
const BYTES = TIANDITU_TERRAIN_SAMPLES * TIANDITU_TERRAIN_SAMPLES * 2;
// 超出这个范围的值当 0：官方插件的做法（无效值）
const VALID_MIN = -2000;
const VALID_MAX = 10000;
// 解压后的瓦片最多留这么多块（每块 45 KB）：贴地取高度和换成墨卡托瓦片共用
const CACHE_TILES = 256;

/** 一块瓦片的地址；子域按 x + y 轮流用 t0～t7 */
export function tiandituTerrainUrl(key: string, level: number, x: number, y: number): string {
  const host = `t${(x + y) % 8}.tianditu.gov.cn`;
  return `https://${host}/mapservice/swdx?T=elv_c&x=${x}&y=${y}&l=${level}&tk=${encodeURIComponent(key)}`;
}

/**
 * 解压、读成高度（米）：解不开、解压后不是 150×150 个 int16 时抛错，错误里带上服务器给的文字（key 不对、超出配额这类）
 */
export async function decodeTiandituTerrain(data: ArrayBuffer): Promise<Int16Array> {
  let bytes: ArrayBuffer;
  try {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
    bytes = await new Response(stream).arrayBuffer();
  } catch (error) {
    const text = new TextDecoder().decode(data.slice(0, 200));
    throw new Error(`天地图地形瓦片不是压缩的高程数据：${text}`, { cause: error });
  }
  if (bytes.byteLength !== BYTES) {
    throw new Error(`天地图地形瓦片解压后是 ${bytes.byteLength} 字节，应为 ${BYTES}`);
  }
  const view = new DataView(bytes);
  const heights = new Int16Array(TIANDITU_TERRAIN_SAMPLES * TIANDITU_TERRAIN_SAMPLES);
  for (let i = 0; i < heights.length; i++) {
    const value = view.getInt16(i * 2, true);
    heights[i] = value < VALID_MIN || value > VALID_MAX ? 0 : value;
  }
  return heights;
}

/** 下载一块瓦片的原始数据：不存在（404）时为 null；signal 中止时以它的原因结束 */
export type FetchTerrainTile = (url: string, signal: AbortSignal) => Promise<ArrayBuffer | null>;

/** 读取器的选项：天地图的 key，下载一块瓦片的函数（不给时用 fetch，测试时换掉） */
export interface TiandituTerrainReaderOptions {
  readonly key: string;
  readonly fetchTile?: FetchTerrainTile;
}

async function fetchTile(url: string, signal: AbortSignal): Promise<ArrayBuffer | null> {
  const response = await fetch(url, { signal });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`天地图地形瓦片请求失败：HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

// 这一级的经纬度换成瓦片里的连续坐标：整数部分是瓦片号，小数部分是瓦片里的位置
function tileCoordinates(level: number, lng: number, lat: number): { readonly tx: number; readonly ty: number } {
  const size = 360 / 2 ** level;
  return { tx: (lng + 180) / size, ty: (90 - lat) / size };
}

// 墨卡托的 y（0～1，北为 0）换成纬度
function latitudeOf(mercatorY: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * mercatorY))) * 180) / Math.PI;
}

/**
 * 天地图地形的读取器：按级别和瓦片号下载、解压、缓存；取一个经纬度的高度（贴地用），或者重采样成一块墨卡托瓦片
 * （MapLibre 的 raster-dem 用）。同一块瓦片同时有几处要时只下载一次；失败的不缓存，下次再要时重新下载
 */
export class TiandituTerrainReader {
  readonly #key: string;
  readonly #fetch: FetchTerrainTile;
  readonly #tiles = new Map<string, Promise<Int16Array | null>>();

  constructor({ key, fetchTile: fetcher = fetchTile }: TiandituTerrainReaderOptions) {
    this.#key = key;
    this.#fetch = fetcher;
  }

  /** 这个经纬度的高度（米），按最细一级双线性插值；瓦片不存在时是 0 */
  async heightAt(lng: number, lat: number, signal: AbortSignal): Promise<number> {
    const level = TIANDITU_TERRAIN_MAX_LEVEL;
    const { tx, ty } = tileCoordinates(level, lng, lat);
    const x = Math.floor(tx);
    const y = Math.min(Math.floor(ty), 2 ** (level - 1) - 1);
    const heights = await this.#tile(level, x, y, signal);
    return heights ? sample(heights, (tx - x) * CELLS, (ty - y) * CELLS) : 0;
  }

  /**
   * 一块墨卡托瓦片（z/x/y）的高度，size × size 个，行优先、第 0 行在北；第 i 个采样在瓦片的 i/size 处（左上角对齐，
   * 和 MapLibre 读 raster-dem 的方式一致）。用天地图同一级（夹到有数据的级别）的瓦片：经度上两者的边界正好对齐，
   * 纬度上最多跨两块
   */
  async mercatorTile(z: number, x: number, y: number, size: number, signal: AbortSignal): Promise<Float32Array> {
    const level = Math.min(Math.max(z, TIANDITU_TERRAIN_MIN_LEVEL), TIANDITU_TERRAIN_MAX_LEVEL);
    const scale = 2 ** z;
    const rows = 2 ** (level - 1);
    const columns = new Float64Array(size);
    const latitudes = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      columns[i] = ((x + i / size) / scale) * 360 - 180;
      latitudes[i] = latitudeOf((y + i / size) / scale);
    }
    // 先把要用到的瓦片都下载下来：左上、右下两个角所在的瓦片之间的都要
    const first = tileCoordinates(level, columns[0], latitudes[0]);
    const last = tileCoordinates(level, columns[size - 1], latitudes[size - 1]);
    const tiles = new Map<string, Int16Array | null>();
    const loads: Promise<void>[] = [];
    for (let tileY = Math.floor(first.ty); tileY <= Math.min(Math.floor(last.ty), rows - 1); tileY++) {
      for (let tileX = Math.floor(first.tx); tileX <= Math.floor(last.tx); tileX++) {
        const key = `${tileX}/${tileY}`;
        loads.push(this.#tile(level, tileX, tileY, signal).then(heights => void tiles.set(key, heights)));
      }
    }
    await Promise.all(loads);
    const out = new Float32Array(size * size);
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        const { tx, ty } = tileCoordinates(level, columns[column], latitudes[row]);
        const tileX = Math.floor(tx);
        const tileY = Math.min(Math.floor(ty), rows - 1);
        const heights = tiles.get(`${tileX}/${tileY}`);
        out[row * size + column] = heights ? sample(heights, (tx - tileX) * CELLS, (ty - tileY) * CELLS) : 0;
      }
    }
    return out;
  }

  // 下载、解压一块，缓存起来；共用的下载不跟着某一个调用方中止，调用方自己的 signal 只结束它自己的等待
  async #tile(level: number, x: number, y: number, signal: AbortSignal): Promise<Int16Array | null> {
    signal.throwIfAborted();
    const key = `${level}/${x}/${y}`;
    let tile = this.#tiles.get(key);
    if (tile) {
      // 用过的挪到最后：淘汰从最久没用的开始
      this.#tiles.delete(key);
      this.#tiles.set(key, tile);
    } else {
      const loading = this.#load(level, x, y);
      tile = loading;
      this.#tiles.set(key, loading);
      void loading.catch(() => {
        if (this.#tiles.get(key) === loading) {
          this.#tiles.delete(key);
        }
      });
      while (this.#tiles.size > CACHE_TILES) {
        const [oldest] = this.#tiles.keys();
        this.#tiles.delete(oldest);
      }
    }
    return raceAbort(tile, signal);
  }

  async #load(level: number, x: number, y: number): Promise<Int16Array | null> {
    const data = await this.#fetch(tiandituTerrainUrl(this.#key, level, x, y), new AbortController().signal);
    return data ? decodeTiandituTerrain(data) : null;
  }
}

// 瓦片里 (column, row) 处的高度（以采样间隔为单位的连续坐标）：双线性插值
function sample(heights: Int16Array, column: number, row: number): number {
  const c0 = Math.min(Math.max(Math.floor(column), 0), CELLS - 1);
  const r0 = Math.min(Math.max(Math.floor(row), 0), CELLS - 1);
  const fc = Math.min(Math.max(column - c0, 0), 1);
  const fr = Math.min(Math.max(row - r0, 0), 1);
  const at = (r: number, c: number) => heights[r * TIANDITU_TERRAIN_SAMPLES + c];
  const top = at(r0, c0) * (1 - fc) + at(r0, c0 + 1) * fc;
  const bottom = at(r0 + 1, c0) * (1 - fc) + at(r0 + 1, c0 + 1) * fc;
  return top * (1 - fr) + bottom * fr;
}

// 等共用的下载，但自己的 signal 中止时先以中止的原因结束
async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const listening = new AbortController();
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(abortReason(signal)), { once: true, signal: listening.signal });
      })
    ]);
  } finally {
    listening.abort();
  }
}

/** 高度编码成 terrarium（MapLibre 的 raster-dem 能读）：(R × 256 + G + B / 256) − 32768 米，不透明 */
export function encodeTerrarium(heights: Float32Array): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(heights.length * 4);
  for (let i = 0; i < heights.length; i++) {
    const value = Math.min(Math.max(heights[i] + 32768, 0), 65535.99);
    const whole = Math.floor(value);
    rgba[i * 4] = whole >> 8;
    rgba[i * 4 + 1] = whole & 0xff;
    rgba[i * 4 + 2] = Math.floor((value - whole) * 256);
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
