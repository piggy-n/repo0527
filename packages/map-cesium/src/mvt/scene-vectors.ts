import type { SymbolLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  Cartesian2,
  Cartesian3,
  type CesiumWidget,
  Color,
  HorizontalOrigin,
  type ImageryLayer,
  type ImageryTypes,
  LabelCollection,
  LabelStyle,
  Math as CesiumMath,
  SceneTransforms,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  WebMercatorTilingScheme
} from 'cesium';
import { MvtPool, type MvtPoolStats } from './mvt-pool';
import type { IdentifiedFeature, LabelCandidate, PatternImage, RenderReply, VectorLayerSpecification } from './mvt-protocol';
import { sourceTile, type TileCoord, tileBounds, tileKey, tilePoint } from './tile-math';

// 方案 B 的 PoC：矢量数据源在 Cesium 里的显示（移植自旧项目的 MvtRasterLayer.js、MvtLabelLayer.js）。
// 每个数据源一个影像图层，位图由 Worker 画；symbol 图层的文字用 Cesium 的标注，主线程只做屏幕避让

/** 一个矢量数据源和画它的图层（从下到上），由 planSceneStyle 从二维的样式推导 */
export interface VectorPlan {
  readonly sourceId: string;
  /** 瓦片地址模板 */
  readonly tiles: string;
  readonly minzoom: number;
  readonly maxzoom: number;
  readonly layers: readonly VectorLayerSpecification[];
  readonly labelLayers: readonly SymbolLayerSpecification[];
  /** 数据源的 promoteId：识别时要留下的业务主键 */
  readonly promoteId: string | null;
  /** 地址、级别、图层都没变时相同：相同就不重画 */
  readonly key: string;
}

export interface VectorOptions {
  /** 瓦片请求要带的请求头（登录的 token），同二维的 transformRequest */
  readonly requestHeaders?: (url: string) => Readonly<Record<string, string>> | undefined;
  /** 识别时另外要留下的属性 */
  readonly identifyKeys?: readonly string[];
}

export interface VectorHit {
  readonly sourceId: string;
  readonly features: readonly IdentifiedFeature[];
}

export interface VectorStats extends MvtPoolStats {
  readonly sources: number;
  readonly labels: number;
}

// 位图的边长，也是对 Cesium 声明的瓦片尺寸。必须是 512：Cesium 按屏幕上贴图像素的间距反推用第几级影像，
// 公式里除以 tileWidth，声明 1024 会比二维低一级，取到的是服务端综合得更粗的数据（旧项目实测）
const TILE_SIZE = 512;
// 数据源最大级别以上再放大几级：用父瓦片的矢量重新栅格化，线和边保持清晰
const OVERZOOM_LEVELS = 3;
const TILE_RETRY_LIMIT = 2;
// 记住多少张画过的瓦片（标注从里面挑）
const LOADED_LIMIT = 4096;
const LABEL_REFRESH_DELAY = 180;
const LABEL_CANDIDATE_LIMIT = 5000;
const LABEL_LIMIT = 2000;
// 除最深的一级外再带几级粗瓦片：深瓦片没到齐的地方由粗的顶上，否则标注一半有一半无
const COARSE_FALLBACK_LEVELS = 2;
const DECLUTTER_CELL = 32;

// 空白位图用很小的画布：这一级没有图层、瓦片里没有要素时都交它，512 的话每张白占 1 MB 显存
let blank: HTMLCanvasElement | null = null;
function blankTile(): HTMLCanvasElement {
  if (!blank) {
    blank = document.createElement('canvas');
    blank.width = 4;
    blank.height = 4;
  }
  return blank;
}

const fill = (template: string, { z, x, y }: TileCoord) =>
  template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

/** 冒充影像提供者：Cesium 来要位图时交给 Worker 池。借用 UrlTemplateImageryProvider 的瓦片方案和错误事件，不用它下载 */
class MvtImageryProvider extends UrlTemplateImageryProvider {
  readonly #plan: VectorPlan;
  readonly #render: (tile: TileCoord) => Promise<RenderReply>;

  constructor(plan: VectorPlan, render: (tile: TileCoord) => Promise<RenderReply>) {
    super({
      url: 'about:blank',
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      // 不能写数据源的最小级别：Cesium 会在全球视角请求这一级的全部瓦片；更低的级别交空白位图
      minimumLevel: 0,
      maximumLevel: plan.maxzoom + OVERZOOM_LEVELS,
      tilingScheme: new WebMercatorTilingScheme(),
      hasAlphaChannel: true,
      enablePickFeatures: false
    });
    this.#plan = plan;
    this.#render = render;
    // 没有监听时 Cesium 把每张失败的瓦片打印一遍；顺便给几次重试
    this.errorEvent.addEventListener((error: { retry?: boolean; timesRetried: number }) => {
      error.retry = error.timesRetried < TILE_RETRY_LIMIT;
    });
  }

  // 只看级别，和相机无关：按视角跳过的话，交出去的空白位图会被 Cesium 当成已加载的瓦片一直留着（旧项目踩过）
  #activeAt(level: number): boolean {
    return (
      level >= this.#plan.minzoom &&
      this.#plan.layers.some(
        layer => layer.layout?.visibility !== 'none' && level >= (layer.minzoom ?? 0) && level < (layer.maxzoom ?? 24)
      )
    );
  }

  override requestImage(x: number, y: number, level: number): Promise<ImageryTypes> | undefined {
    if (!this.#activeAt(level)) {
      return Promise.resolve(blankTile());
    }
    // 下载失败时照样拒绝：交透明图的话这块地方到图层重建为止都是空的，拒绝后 Cesium 用父级瓦片顶上
    return this.#render({ z: level, x, y }).then(reply => reply.bitmap ?? blankTile());
  }
}

interface LabelBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** 一个 symbol 图层的文字：只取视野里已经画过的瓦片，相机停下、新瓦片到达时刷新 */
class VectorLabels implements Disposable {
  readonly #widget: CesiumWidget;
  readonly #pool: MvtPool;
  readonly #sourceId: string;
  readonly #layer: SymbolLayerSpecification;
  readonly #loaded: Map<string, TileCoord>;
  readonly #zoom: () => number;
  readonly #collection: LabelCollection;
  #timer: ReturnType<typeof setTimeout> | undefined;
  // 取候选是一次异步往返，期间视角可能又变了：只认最后一次
  #revision = 0;
  #shown = 0;

  constructor(
    widget: CesiumWidget,
    pool: MvtPool,
    sourceId: string,
    layer: SymbolLayerSpecification,
    loaded: Map<string, TileCoord>,
    zoom: () => number
  ) {
    this.#widget = widget;
    this.#pool = pool;
    this.#sourceId = sourceId;
    this.#layer = layer;
    this.#loaded = loaded;
    this.#zoom = zoom;
    this.#collection = widget.scene.primitives.add(new LabelCollection());
  }

  get shown(): number {
    return this.#shown;
  }

  schedule(): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#refresh().catch(() => undefined), LABEL_REFRESH_DELAY);
  }

  [Symbol.dispose](): void {
    clearTimeout(this.#timer);
    this.#revision++;
    if (!this.#widget.isDestroyed()) {
      this.#widget.scene.primitives.remove(this.#collection);
    }
  }

  async #refresh(): Promise<void> {
    const revision = ++this.#revision;
    const minzoom = this.#layer.minzoom ?? 0;
    const tiles = this.#zoom() >= minzoom && this.#layer.layout?.visibility !== 'none' ? this.#visibleTiles(minzoom) : [];
    if (tiles.length === 0) {
      this.#show([], null);
      return;
    }
    const reply = await this.#pool.labels(this.#sourceId, this.#layer.id, tiles, LABEL_CANDIDATE_LIMIT);
    if (revision !== this.#revision || this.#widget.isDestroyed()) {
      return;
    }
    for (const key of reply?.missing ?? []) {
      this.#loaded.delete(key);
    }
    if (!reply) {
      this.#show([], null);
      return;
    }
    const size = reply.paint.size;
    this.#show(this.#declutter(uncovered(reply.candidates, tiles), size), reply.paint);
  }

  // 最深的一级只在和视野相交的瓦片里挑：缓存里还留着之前看过的地方，别处的深瓦片会把级别抬上去
  #visibleTiles(minzoom: number): TileCoord[] {
    const view = this.#widget.camera.computeViewRectangle();
    if (!view) {
      return [];
    }
    const west = CesiumMath.toDegrees(view.west);
    const south = CesiumMath.toDegrees(view.south);
    const east = CesiumMath.toDegrees(view.east);
    const north = CesiumMath.toDegrees(view.north);
    const inView = [...this.#loaded.values()].filter(tile => {
      const [tileWest, tileSouth, tileEast, tileNorth] = tileBounds(tile);
      return tile.z >= minzoom && !(tileEast < west || tileWest > east || tileSouth > north || tileNorth < south);
    });
    const deepest = Math.max(-1, ...inView.map(tile => tile.z));
    return inView.filter(tile => tile.z >= deepest - COARSE_FALLBACK_LEVELS);
  }

  // 屏幕上贪心避让（等价于二维的 text-allow-overlap: false）：放下的框按网格分桶，候选只和自己压到的几格比
  #declutter(candidates: readonly LabelCandidate[], size: number): LabelCandidate[] {
    const { scene } = this.#widget;
    const grid = new Map<string, LabelBox[]>();
    const placed: LabelCandidate[] = [];
    const position = new Cartesian3();
    const onScreen = new Cartesian2();
    const halfHeight = (size + 6) / 2;
    for (const candidate of candidates) {
      if (placed.length >= LABEL_LIMIT) {
        break;
      }
      Cartesian3.fromDegrees(candidate.lng, candidate.lat, 0, undefined, position);
      const point = SceneTransforms.worldToWindowCoordinates(scene, position, onScreen);
      if (!point) {
        continue;
      }
      // 汉字按一个字一个字号的宽度估
      const halfWidth = (candidate.text.length * size + 6) / 2;
      const box = { minX: point.x - halfWidth, minY: point.y - halfHeight, maxX: point.x + halfWidth, maxY: point.y + halfHeight };
      const cells: string[] = [];
      for (let cellY = Math.floor(box.minY / DECLUTTER_CELL); cellY <= Math.floor(box.maxY / DECLUTTER_CELL); cellY++) {
        for (let cellX = Math.floor(box.minX / DECLUTTER_CELL); cellX <= Math.floor(box.maxX / DECLUTTER_CELL); cellX++) {
          cells.push(`${cellX}|${cellY}`);
        }
      }
      const overlaps = (other: LabelBox) =>
        !(box.maxX < other.minX || box.minX > other.maxX || box.maxY < other.minY || box.minY > other.maxY);
      if (cells.some(cell => grid.get(cell)?.some(overlaps))) {
        continue;
      }
      for (const cell of cells) {
        grid.set(cell, [...(grid.get(cell) ?? []), box]);
      }
      placed.push(candidate);
    }
    return placed;
  }

  // 标注对象留着复用：相机小幅移动时大多数文字没变，Cesium 的 setter 发现值相同会跳过
  #show(placed: readonly LabelCandidate[], paint: { size: number; color: string; haloColor: string; haloWidth: number } | null): void {
    const labels = this.#collection;
    for (const [index, candidate] of placed.entries()) {
      const label =
        index < labels.length
          ? labels.get(index)
          : labels.add({
              position: Cartesian3.ZERO,
              style: LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: VerticalOrigin.CENTER,
              horizontalOrigin: HorizontalOrigin.CENTER,
              disableDepthTestDistance: Number.POSITIVE_INFINITY
            });
      label.position = Cartesian3.fromDegrees(candidate.lng, candidate.lat);
      label.text = candidate.text;
      if (paint) {
        // 字体跟页面走，同覆盖物的文字
        label.font = `${paint.size}px ${getComputedStyle(this.#widget.container).fontFamily}`;
        label.fillColor = Color.fromCssColorString(paint.color);
        label.outlineColor = Color.fromCssColorString(paint.haloColor);
        // 二维的 text-halo-width 是向外的宽度，画布的描边一半在字里面
        label.outlineWidth = paint.haloWidth * 2;
      }
      label.show = true;
    }
    for (let index = placed.length; index < labels.length; index++) {
      labels.get(index).show = false;
    }
    this.#shown = placed.length;
    this.#widget.scene.requestRender();
  }
}

// 同一块地方同时有深瓦片和粗瓦片的候选时只留深的：把候选点换算到更深那一级，看那张瓦片在不在这次挑的里面
function uncovered(candidates: readonly LabelCandidate[], tiles: readonly TileCoord[]): LabelCandidate[] {
  const keys = new Set(tiles.map(tileKey));
  const levels = [...new Set(tiles.map(tile => tile.z))].toSorted((a, b) => b - a);
  const kept = candidates.filter(
    candidate =>
      !levels.some(level => {
        if (level <= candidate.tile.z) {
          return false;
        }
        const point = tilePoint(candidate.lng, candidate.lat, level);
        return keys.has(tileKey({ z: level, x: Math.floor(point.x), y: Math.floor(point.y) }));
      })
  );
  // 深的先放
  return kept.toSorted((a, b) => b.tile.z - a.tile.z);
}

interface VectorEntry {
  plan: VectorPlan;
  layer: ImageryLayer;
  unsubscribe: () => void;
  /** 画过、有要素的下载瓦片 */
  readonly loaded: Map<string, TileCoord>;
  labels: VectorLabels[];
}

export interface VectorEvents {
  /** 瓦片下载或绘制失败，按二维的数据源 ID */
  readonly error: (sourceId: string, error: unknown) => void;
  /** 相机的缩放级（二维口径） */
  readonly zoom: () => number;
}

// 样式里引用到的图片：图片的 ID 以字面量出现在 fill-pattern 的表达式里
function usedImages(plan: VectorPlan, images: Readonly<Record<string, PatternImage>>): Record<string, PatternImage> {
  const text = JSON.stringify(plan.layers.map(layer => (layer.type === 'fill' ? layer.paint?.['fill-pattern'] : undefined)));
  return Object.fromEntries(Object.entries(images).filter(([id]) => text.includes(JSON.stringify(id))));
}

/** 场景里的矢量数据源：按样式增删改，Worker 池在第一次用到时创建 */
export class SceneVectors implements Disposable {
  readonly #widget: CesiumWidget;
  readonly #events: VectorEvents;
  readonly #entries = new Map<string, VectorEntry>();
  // 换样式时被替换的影像图层：留到新的画好再移除，重画期间不空白
  #retiring: ImageryLayer[] = [];
  #pool: MvtPool | null = null;
  #options: VectorOptions = {};

  constructor(widget: CesiumWidget, events: VectorEvents) {
    this.#widget = widget;
    this.#events = events;
  }

  /** 没有在画的位图、没有等着移除的旧图层 */
  get idle(): boolean {
    return (this.#pool?.pending ?? 0) === 0 && this.#retiring.length === 0;
  }

  get active(): boolean {
    return this.#entries.size > 0;
  }

  apply(plans: readonly VectorPlan[], images: Readonly<Record<string, PatternImage>>, options: VectorOptions): void {
    this.#options = options;
    const layers = this.#widget.imageryLayers;
    for (const [id, entry] of this.#entries) {
      if (!plans.some(plan => plan.sourceId === id)) {
        this.#remove(id, entry);
      }
    }
    for (const plan of plans) {
      const entry = this.#entries.get(plan.sourceId);
      if (entry?.plan.key === plan.key) {
        continue;
      }
      this.#pool ??= new MvtPool();
      const pool = this.#pool;
      pool.configure(plan.sourceId, {
        tiles: plan.tiles,
        minzoom: plan.minzoom,
        maxzoom: plan.maxzoom,
        tileSize: TILE_SIZE,
        layers: plan.layers,
        labelLayers: plan.labelLayers,
        images: usedImages(plan, images),
        identifyKeys: [...(plan.promoteId === null ? [] : [plan.promoteId]), ...(options.identifyKeys ?? [])]
      });
      const loaded = entry && entry.plan.tiles === plan.tiles ? entry.loaded : new Map<string, TileCoord>();
      const provider = new MvtImageryProvider(plan, tile => this.#render(plan, tile, loaded));
      const unsubscribe = provider.errorEvent.addEventListener((error: unknown) => {
        if (this.#entries.get(plan.sourceId)?.plan === plan) {
          this.#events.error(plan.sourceId, error);
        }
      });
      if (entry) {
        entry.unsubscribe();
        entry.labels.forEach(labels => labels[Symbol.dispose]());
        this.#retiring.push(entry.layer);
      }
      const labels = plan.labelLayers.map(
        layer => new VectorLabels(this.#widget, pool, plan.sourceId, layer, loaded, this.#events.zoom)
      );
      this.#entries.set(plan.sourceId, { plan, layer: layers.addImageryProvider(provider), unsubscribe, loaded, labels });
      labels.forEach(item => item.schedule());
    }
    // 依次提到最上面：和样式里数据源的顺序一致，都在栅格底图上面
    for (const plan of plans) {
      const entry = this.#entries.get(plan.sourceId);
      if (entry) {
        layers.raiseToTop(entry.layer);
      }
    }
  }

  cameraIdle(): void {
    for (const entry of this.#entries.values()) {
      entry.labels.forEach(labels => labels.schedule());
    }
  }

  /** 每帧渲染后：新图层画好了就移除被替换的；位图不经 Cesium 的请求调度，到了以后要自己请求重画 */
  afterRender(): void {
    if (this.#entries.size === 0 && this.#retiring.length === 0) {
      return;
    }
    const { scene, imageryLayers } = this.#widget;
    if (!scene.globe.tilesLoaded) {
      scene.requestRender();
      return;
    }
    if (this.#retiring.length > 0 && (this.#pool?.pending ?? 0) === 0) {
      for (const layer of this.#retiring) {
        imageryLayers.remove(layer, true);
      }
      this.#retiring = [];
      scene.requestRender();
    }
  }

  /** 识别一个位置：按数据源从上到下 */
  async identify(lng: number, lat: number, zoom: number, tolerance: number): Promise<VectorHit[]> {
    const pool = this.#pool;
    if (!pool) {
      return [];
    }
    const entries = [...this.#entries.values()].toReversed();
    const hits = await Promise.all(
      entries.map(async ({ plan }) => {
        const level = Math.min(plan.maxzoom, Math.floor(zoom));
        const point = tilePoint(lng, lat, level);
        const tile = { z: level, x: Math.floor(point.x), y: Math.floor(point.y) };
        const features = await pool.identify(plan.sourceId, { lng, lat, zoom, tolerance }, tile, this.#headers(plan, tile));
        return { sourceId: plan.sourceId, features };
      })
    );
    return hits.filter(({ features }) => features.length > 0);
  }

  async stats(): Promise<VectorStats | null> {
    if (!this.#pool) {
      return null;
    }
    const entries = [...this.#entries.values()];
    return {
      ...(await this.#pool.stats()),
      sources: entries.length,
      labels: entries.reduce((total, entry) => total + entry.labels.reduce((sum, labels) => sum + labels.shown, 0), 0)
    };
  }

  [Symbol.dispose](): void {
    for (const [id, entry] of this.#entries) {
      this.#remove(id, entry);
    }
    this.#retiring = [];
    this.#pool?.[Symbol.dispose]();
    this.#pool = null;
  }

  async #render(plan: VectorPlan, tile: TileCoord, loaded: Map<string, TileCoord>): Promise<RenderReply> {
    const pool = this.#pool;
    if (!pool) {
      throw new DOMException('Worker 池已释放', 'AbortError');
    }
    try {
      const reply = await pool.render(plan.sourceId, tile, this.#headers(plan, sourceTile(tile, plan.maxzoom)));
      if (reply.source && reply.features > 0 && !loaded.has(tileKey(reply.source))) {
        loaded.set(tileKey(reply.source), reply.source);
        if (loaded.size > LOADED_LIMIT) {
          const [oldest] = loaded.keys();
          if (oldest !== undefined) {
            loaded.delete(oldest);
          }
        }
        this.#entries.get(plan.sourceId)?.labels.forEach(labels => labels.schedule());
      }
      return reply;
    } finally {
      if (!this.#widget.isDestroyed()) {
        this.#widget.scene.requestRender();
      }
    }
  }

  // 请求头按实际下载的那张瓦片的地址算
  #headers(plan: VectorPlan, tile: TileCoord): Readonly<Record<string, string>> | null {
    return this.#options.requestHeaders?.(fill(plan.tiles, tile)) ?? null;
  }

  #remove(id: string, entry: VectorEntry): void {
    entry.unsubscribe();
    entry.labels.forEach(labels => labels[Symbol.dispose]());
    this.#pool?.remove(id);
    if (!this.#widget.isDestroyed()) {
      this.#widget.imageryLayers.remove(entry.layer, true);
    }
    this.#entries.delete(id);
  }
}
