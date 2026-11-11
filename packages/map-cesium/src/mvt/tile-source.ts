import type {
  IdentifiedFeature,
  LabelCandidate,
  LabelReply,
  TileTiming,
  VectorSourceConfig
} from './mvt-protocol';
import { anchorOf, decodeTile, type DecodedTile, polygonContains, polygonsOf, ringDistanceSq, signedArea, type TileFeature } from './tile-geometry';
import { lngLatOf, sourceTile, type TileCoord, tileKey, tilePoint } from './tile-math';
import { paintTile, PatternStore } from './tile-painter';
import { CompiledLabelLayer, CompiledLayer } from './tile-style';

// 方案 B 的 PoC：一个矢量数据源在 Worker 里的全部工作，下载、解码、几何缓存、栅格化、标注候选、识别
// （移植自旧项目 tileRenderer.js 的 TileSource）。解码后的几何只留在 Worker 里（ADR 0025 第 6 节）

type Headers = Readonly<Record<string, string>> | null;

interface LoadedTile extends DecodedTile {
  readonly timing: Omit<TileTiming, 'drawMs'>;
}

export interface RenderedTile {
  /** 全透明时为 null */
  readonly canvas: OffscreenCanvas | null;
  readonly source: TileCoord | null;
  readonly features: number;
  readonly timing: TileTiming;
}

const NOT_FETCHED: Omit<TileTiming, 'drawMs'> = { fetched: false, fetchMs: 0, decodeMs: 0, bytes: 0, transferBytes: null };

// 识别最多返回几个要素
const IDENTIFY_LIMIT = 20;

// 经网络传输的字节数：0 是浏览器的 HTTP 缓存。同源请求才读得到，读不到时为 null
function transferBytesOf(url: string): number | null {
  const entry = performance.getEntriesByName(url, 'resource').at(-1);
  return entry instanceof PerformanceResourceTiming ? entry.transferSize : null;
}

// Worker 的资源计时默认只留 250 条，满了以后读不到新的
performance.setResourceTimingBufferSize(20000);

export class TileSource {
  #config: VectorSourceConfig;
  #layers: CompiledLayer[] = [];
  #labels: CompiledLabelLayer[] = [];
  #patterns: PatternStore;
  // 解码时留下的属性；null 是全留
  #keep: ReadonlySet<string> | null = null;
  #budget: number;
  #bytes = 0;
  // 只缓存实际下载的瓦片；Map 保持插入序，从最早的开始淘汰
  readonly #cache = new Map<string, DecodedTile>();
  // 同一张瓦片的并发请求（超过最大级别时的各个子区域）只下载一次
  readonly #pending = new Map<string, Promise<LoadedTile>>();

  constructor(config: VectorSourceConfig, budget: number) {
    this.#config = config;
    this.#budget = budget;
    this.#patterns = new PatternStore(config.images);
    this.#compile();
  }

  get cacheTiles(): number {
    return this.#cache.size;
  }

  get cacheBytes(): number {
    return this.#bytes;
  }

  /** 换样式：地址变了、或者新样式要读的属性上次解码时没留下，缓存作废；只改颜色、透明度时几何照用 */
  update(config: VectorSourceConfig): void {
    const previousKeep = this.#keep;
    const sameTiles = config.tiles === this.#config.tiles;
    this.#config = config;
    this.#patterns = new PatternStore(config.images);
    this.#compile();
    const next = this.#keep;
    const covered = previousKeep === null || (next !== null && [...next].every(key => previousKeep.has(key)));
    if (!sameTiles || !covered) {
      this.#cache.clear();
      this.#bytes = 0;
    }
  }

  setBudget(bytes: number): void {
    this.#budget = bytes;
    this.#trim();
  }

  #compile(): void {
    const { layers, labelLayers, identifyKeys } = this.#config;
    this.#layers = layers.map(layer => new CompiledLayer(layer));
    this.#labels = labelLayers.map(layer => new CompiledLabelLayer(layer));
    const keep = new Set(identifyKeys);
    let known = true;
    for (const { accessed } of [...this.#layers, ...this.#labels]) {
      known &&= accessed !== null;
      accessed?.forEach(key => keep.add(key));
    }
    this.#keep = known ? keep : null;
  }

  /** 画一张位图；下载失败时抛错（调用方据此让 Cesium 用父级瓦片，不能交一张透明图） */
  async render(tile: TileCoord, headers: Headers): Promise<RenderedTile> {
    const active = this.#layers.filter(layer => layer.activeAt(tile.z));
    if (tile.z < this.#config.minzoom || active.length === 0) {
      return { canvas: null, source: null, features: 0, timing: { ...NOT_FETCHED, drawMs: 0 } };
    }
    const source = sourceTile(tile, this.#config.maxzoom);
    const loaded = await this.#tile(source, headers);
    const started = performance.now();
    const { tileSize: size } = this.#config;
    const factor = 2 ** (tile.z - source.z);
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('拿不到 OffscreenCanvas 的 2d 上下文');
    }
    const frame = { size, factor, column: tile.x - source.x * factor, row: tile.y - source.y * factor };
    const features = loaded.features.length === 0 ? 0 : paintTile(context, active, loaded.features, tile.z, frame, this.#patterns);
    return {
      canvas: features > 0 ? canvas : null,
      source,
      features,
      timing: { ...loaded.timing, drawMs: performance.now() - started }
    };
  }

  /**
   * 指定瓦片里的标注候选：面的每个部分各一个，锚点是面内离边界最远的点（和 MapLibre 的面标注一致），点要素用它自己。
   * 超过 limit 时按面积留大的
   */
  labels(layerId: string, tiles: readonly TileCoord[], limit: number): LabelReply {
    const layer = this.#labels.find(({ id }) => id === layerId);
    const missing: string[] = [];
    let candidates: LabelCandidate[] = [];
    let zoom = 0;
    for (const tile of tiles) {
      zoom = Math.max(zoom, tile.z);
      const cached = this.#cache.get(tileKey(tile));
      if (!cached) {
        // 主线程那份"已画过的瓦片"名单按张数封顶，这里按字节淘汰，两边会越走越偏：报回去让它修正
        missing.push(tileKey(tile));
        continue;
      }
      if (!layer?.activeAt(tile.z)) {
        continue;
      }
      for (const feature of cached.features) {
        const text = feature.type === 2 ? '' : layer.textOf(feature, tile.z);
        if (text === '') {
          continue;
        }
        if (feature.type === 1) {
          const [ring] = feature.rings;
          const [lng, lat] = lngLatOf(ring?.[0] ?? 0, ring?.[1] ?? 0, feature.extent, tile);
          candidates.push({ lng, lat, text, area: 0, tile });
          continue;
        }
        for (const polygon of polygonsOf(feature)) {
          const [x, y] = anchorOf(polygon, feature.extent);
          const [lng, lat] = lngLatOf(x, y, feature.extent, tile);
          candidates.push({ lng, lat, text, area: Math.abs(signedArea(polygon.exterior)), tile });
        }
      }
    }
    if (candidates.length > limit) {
      candidates = candidates.toSorted((a, b) => b.area - a.area).slice(0, limit);
    }
    return { candidates, missing, paint: (layer ?? new CompiledLabelLayer({ id: layerId, type: 'symbol', source: '' })).paintAt(zoom) };
  }

  /**
   * 识别一个位置的要素（瓦片数据服务的原型）：不依赖画过什么，缓存里没有就下载。
   * 面取包含这个点的，线和点按屏幕像素的容差；返回的属性只有解码时留下的那些（业务主键在里面）
   */
  async identify(lng: number, lat: number, zoom: number, tolerance: number, headers: Headers): Promise<IdentifiedFeature[]> {
    const { minzoom, maxzoom, tileSize } = this.#config;
    const level = Math.min(maxzoom, Math.floor(zoom));
    const layers = this.#layers.filter(layer => layer.activeAt(level));
    if (level < minzoom || layers.length === 0) {
      return [];
    }
    const point = tilePoint(lng, lat, level);
    const tile = { z: level, x: Math.floor(point.x), y: Math.floor(point.y) };
    const { features } = await this.#tile(tile, headers);
    const found: IdentifiedFeature[] = [];
    // 后画的在上面，先返回
    for (const feature of features.toReversed()) {
      const x = (point.x - tile.x) * feature.extent;
      const y = (point.y - tile.y) * feature.extent;
      // 屏幕像素换成瓦片坐标：相机比瓦片的级别每高一级，一个像素对应的瓦片坐标减半
      const reach = (tolerance * feature.extent) / (tileSize * 2 ** (zoom - level));
      const [minX, minY, maxX, maxY] = feature.box;
      if (x < minX - reach || x > maxX + reach || y < minY - reach || y > maxY + reach) {
        continue;
      }
      if (!layers.some(layer => layer.matches(feature, level)) || !hits(feature, x, y, reach)) {
        continue;
      }
      found.push({
        sourceLayer: feature.sourceLayer,
        geometry: feature.type === 1 ? 'Point' : feature.type === 2 ? 'LineString' : 'Polygon',
        properties: feature.properties
      });
      if (found.length >= IDENTIFY_LIMIT) {
        break;
      }
    }
    return found;
  }

  #tile(tile: TileCoord, headers: Headers): Promise<LoadedTile> {
    const key = tileKey(tile);
    const cached = this.#cache.get(key);
    if (cached) {
      // 挪到末尾：最近用过的最后淘汰
      this.#cache.delete(key);
      this.#cache.set(key, cached);
      return Promise.resolve({ ...cached, timing: NOT_FETCHED });
    }
    const shared = this.#pending.get(key);
    if (shared) {
      // 共用下载的其他请求不重复计时
      return shared.then(loaded => ({ ...loaded, timing: NOT_FETCHED }));
    }
    const { tiles } = this.#config;
    const pending = this.#load(tile, headers).finally(() => this.#pending.delete(key));
    this.#pending.set(key, pending);
    // 下载期间换了地址的不进缓存；失败的也不进：缓存了就等于把"这里没有数据"钉死
    void pending.then(
      loaded => {
        if (this.#config.tiles === tiles) {
          this.#cache.set(key, { features: loaded.features, bytes: loaded.bytes });
          this.#bytes += loaded.bytes;
          this.#trim();
        }
        return loaded;
      },
      () => undefined
    );
    return pending;
  }

  async #load({ z, x, y }: TileCoord, headers: Headers): Promise<LoadedTile> {
    const url = this.#config.tiles.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
    const started = performance.now();
    const response = await fetch(url, headers ? { headers } : {});
    if (!response.ok) {
      throw new Error(`瓦片 ${z}/${x}/${y} 下载失败：HTTP ${response.status}`);
    }
    // 后端有的瓦片集返回 200 加 JSON 的错误：按失败报告，不当成空瓦片
    if (response.headers.get('content-type')?.includes('json')) {
      throw new Error(`瓦片 ${z}/${x}/${y} 返回的不是矢量瓦片：${(await response.text()).slice(0, 120)}`);
    }
    const buffer = await response.arrayBuffer();
    const fetched = performance.now();
    const decoded = decodeTile(buffer, this.#keep);
    return {
      ...decoded,
      timing: {
        fetched: true,
        fetchMs: fetched - started,
        decodeMs: performance.now() - fetched,
        bytes: buffer.byteLength,
        transferBytes: transferBytesOf(response.url)
      }
    };
  }

  // 至少留一张：否则超大的瓦片存进去就被自己挤掉，反复解码
  #trim(): void {
    for (const [key, tile] of this.#cache) {
      if (this.#bytes <= this.#budget || this.#cache.size <= 1) {
        break;
      }
      this.#cache.delete(key);
      this.#bytes -= tile.bytes;
    }
  }
}

function hits(feature: TileFeature, x: number, y: number, reach: number): boolean {
  if (feature.type === 3) {
    return polygonsOf(feature).some(polygon => polygonContains(polygon, x, y));
  }
  return feature.rings.some(ring => ringDistanceSq(ring, x, y, false) <= reach * reach);
}
