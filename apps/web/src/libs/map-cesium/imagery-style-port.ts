import { GeographicTilingScheme, ImageryLayer, UrlTemplateImageryProvider } from 'cesium';
import type { ImageryLayerCollection, ImageryProvider } from 'cesium';
import { safeReporter } from '@yzt/utils';
import { createGeoJsonProvider, GeoJsonGeometryCache } from './geojson-provider';
import { GeoJsonSources, type GeoJsonLease } from './geojson-source';
import { createRasterProvider } from './raster-provider';
import { createMvtProvider, type MvtProvider } from './mvt-provider';
import { MvtWorkerPool, type MvtWorkerPoolOptions } from './mvt-worker-pool';
import type { StyleMirrorLayer, StyleMirrorPort } from './style-mirror';
import type { BasicStyleLayer } from './style-plan';

interface ImageryStylePortOptions {
  readonly layers: ImageryLayerCollection;
  readonly requestRender: () => void;
  readonly mvt?: MvtWorkerPoolOptions;
  readonly geojson?: { readonly fetch?: typeof fetch };
}

export interface ImageryStylePort extends StyleMirrorPort, Disposable {
  readonly ready: boolean;
  pause(): void;
  resume(): void;
}

interface ImageryResource {
  pending?: boolean;
  readonly layer: ImageryLayer;
  readonly unsubscribe: () => void;
  readonly mvt?: MvtProvider;
  readonly geojson?: GeoJsonLease;
}

// 最底层必须覆盖全球，避免 SDK 把局部影像的边缘拉伸到其他区域
const TRANSPARENT_PIXEL = 'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==';

/** 所有基础图层进入同一个影像集合，跨栅格与 GeoJSON 保持会话的层序 */
export function createImageryStylePort({ layers, requestRender, mvt, geojson }: ImageryStylePortOptions): ImageryStylePort {
  const notifyRender = safeReporter(requestRender, 'ImageryStylePort.requestRender');
  const render = () => notifyRender(undefined);
  const owned = new Set<ImageryStyleLayer>();
  const pool = new MvtWorkerPool(mvt);
  const sources = new GeoJsonSources(geojson);
  const geometry = new GeoJsonGeometryCache();
  let anchor: ImageryLayer | undefined;
  let paused = false;

  // 没有业务层时一起移除锚定影像，生命周期不溢出镜像的拥有范围
  function removeUnusedAnchor(): void {
    if (owned.size === 0 && anchor) {
      const current = anchor;
      anchor = undefined;
      layers.remove(current, true);
    }
  }

  return {
    get ready() { return [...owned].every(handle => handle.ready); },
    create: (layer, zoom, onError) => {
      if (!anchor) {
        anchor = new ImageryLayer(new UrlTemplateImageryProvider({
          url: TRANSPARENT_PIXEL,
          tilingScheme: new GeographicTilingScheme(),
          tileWidth: 1, tileHeight: 1, minimumLevel: 0, maximumLevel: 0,
          enablePickFeatures: false
        }), { gamma: 1 });
        layers.add(anchor, 0);
      }
      try {
        const handle = new ImageryStyleLayer(layer, zoom, layers, pool, sources, geometry, render, onError, () => {
          owned.delete(handle);
          removeUnusedAnchor();
        });
        owned.add(handle);
        return handle;
      } catch (error) {
        removeUnusedAnchor();
        throw error;
      }
    },
    order: ordered => {
      if (ordered.length !== owned.size || new Set(ordered).size !== ordered.length ||
        ordered.some(handle => !(handle instanceof ImageryStyleLayer) || !owned.has(handle))) {
        throw new Error('三维影像排序必须包含本拥有者的全部图层');
      }
      if (anchor) {
        layers.lowerToBottom(anchor);
      }
      for (const handle of ordered) {
        // 入口已检查归属，具体引擎资源不从公共地图接口暴露
        layers.raiseToTop((handle as ImageryStyleLayer).imagery);
      }
    },
    requestRender: render,
    pause: () => {
      paused = true;
      pool.pause();
      for (const handle of owned) { handle.cancelPending(); }
    },
    resume: () => {
      if (!paused) { return; }
      paused = false;
      pool.resume();
      // 已取消的 SDK 影像处于失败状态，恢复时换提供者；Worker 数据缓存仍保留
      for (const handle of owned) { handle.restartPending(); }
      render();
    },
    [Symbol.dispose]: () => {
      for (const handle of owned) { handle[Symbol.dispose](); }
      pool[Symbol.dispose]();
      sources[Symbol.dispose]();
      geometry[Symbol.dispose]();
    }
  };
}

/** 一个会话图层对应一个可替换的影像资源，缩放重画仍保留 handle 身份 */
class ImageryStyleLayer implements StyleMirrorLayer {
  readonly #specification: BasicStyleLayer;
  readonly #collection: ImageryLayerCollection;
  readonly #report: (error: unknown) => void;
  readonly #onDispose: () => void;
  readonly #pool: MvtWorkerPool;
  readonly #sources: GeoJsonSources;
  readonly #geometry: GeoJsonGeometryCache;
  readonly #requestRender: () => void;
  #resource: ImageryResource | undefined;
  #zoom: number;
  #appliedZoom: number;
  #restart = false;

  constructor(
    layer: BasicStyleLayer,
    zoom: number,
    collection: ImageryLayerCollection,
    pool: MvtWorkerPool,
    sources: GeoJsonSources,
    geometry: GeoJsonGeometryCache,
    requestRender: () => void,
    onError: (error: unknown) => void,
    onDispose: () => void
  ) {
    this.#specification = layer;
    this.#collection = collection;
    this.#pool = pool;
    this.#sources = sources;
    this.#geometry = geometry;
    this.#requestRender = requestRender;
    this.#report = safeReporter(onError, 'ImageryStyleLayer');
    this.#onDispose = onDispose;
    this.#zoom = zoom;
    this.#appliedZoom = zoom;
    const resource = this.#create(zoom);
    try {
      collection.add(resource.layer);
      this.#resource = resource;
    } catch (error) {
      this.#release(resource);
      throw error;
    }
  }

  get imagery(): ImageryLayer {
    if (!this.#resource) {
      throw new Error('三维影像已释放');
    }
    return this.#resource.layer;
  }

  get ready(): boolean {
    return !this.#resource?.layer.show || this.#resource.pending !== true;
  }

  setVisible(visible: boolean): void {
    if (!this.#resource || this.#resource.layer.show === visible) {
      return;
    }
    if (visible) {
      this.#resource.layer.show = true;
      this.restartPending();
      this.#applyZoom();
    } else {
      this.cancelPending();
      this.#resource.layer.show = false;
    }
  }

  /** 暂停或隐藏取消过的影像重新开始请求，共享数据不受影响 */
  restartPending(): void {
    if (this.#resource?.layer.show && this.#restart) {
      this.#replace(this.#zoom);
    }
  }

  /** 隐藏、暂停和释放共同撤销当前影像的下载等待 */
  cancelPending(): void {
    this.#restart = Boolean(this.#resource?.mvt || this.#resource?.geojson);
    this.#resource?.mvt?.cancelPending();
    this.#resource?.geojson?.[Symbol.dispose]();
  }

  setZoom(zoom: number): void {
    this.#zoom = zoom;
    if (this.#resource?.layer.show) { this.#applyZoom(); }
  }

  // 隐藏期间只保存目标级别，重新显示或结束运动时才重画
  #applyZoom(): void {
    const previous = this.#resource;
    const zoom = this.#zoom;
    if (!previous || zoom === this.#appliedZoom) {
      return;
    }
    if (this.#specification.type === 'raster') {
      previous.layer.alpha = this.#opacity(zoom);
    } else if (this.#specification.type !== 'background' || this.#specification.zoomDependent) {
      this.#replace(zoom);
    }
    this.#appliedZoom = zoom;
  }

  #replace(zoom: number): void {
    const previous = this.#resource;
    if (!previous) { return; }
    const next = this.#create(zoom);
    next.layer.show = previous.layer.show;
    try {
      this.#collection.add(next.layer, this.#collection.indexOf(previous.layer));
    } catch (error) {
      this.#release(next);
      throw error;
    }
    // 先换身份再解绑旧资源，已排队的旧错误不能归到新影像
    this.#resource = next;
    this.#appliedZoom = zoom;
    this.#restart = false;
    if (!next.layer.show) { this.cancelPending(); }
    this.#release(previous);
  }

  [Symbol.dispose](): void {
    const resource = this.#resource;
    if (!resource) {
      return;
    }
    this.#resource = undefined;
    try {
      this.#release(resource);
    } finally {
      this.#onDispose();
    }
  }

  #create(zoom: number): ImageryResource {
    const specification = this.#specification;
    if (specification.source?.type === 'geojson' && typeof specification.source.data === 'string') {
      return this.#createUrlGeoJson(zoom);
    }
    let provider: ImageryProvider;
    let mvt: MvtProvider | undefined;
    if (specification.type === 'raster') {
      if (specification.source?.type !== 'raster') {
        throw new Error('三维栅格图层缺少栅格数据源');
      }
      provider = createRasterProvider(specification.source);
    } else if (specification.source?.type === 'vector') {
      mvt = createMvtProvider(specification, zoom, this.#pool);
      provider = mvt;
    } else {
      provider = createGeoJsonProvider(specification, zoom, this.#geometry);
    }
    // 全球矩形参与求交会截短跨 180° 经线的范围，直接沿用提供者的范围
    const layer = new ImageryLayer(provider, {
      rectangle: provider.rectangle,
      alpha: this.#opacity(zoom), brightness: 1, contrast: 1, hue: 0, saturation: 1, gamma: 1
    });
    const resource: ImageryResource = {
      layer,
      mvt,
      unsubscribe: provider.errorEvent.addEventListener((error: unknown) => {
        if (this.#resource === resource && !isCancellation(error)) {
          this.#report(error);
        }
      })
    };
    return resource;
  }

  // 保持影像层身份和顺序，数据就绪后再交给同一套内联绘制路径
  #createUrlGeoJson(zoom: number): ImageryResource {
    const specification = this.#specification;
    const source = specification.source;
    if (source?.type !== 'geojson') { throw new Error('缺少 GeoJSON 数据源'); }
    const lease = this.#sources.acquire(source);
    const provider = lease.promise.then(data => {
      lease.signal.throwIfAborted();
      return createGeoJsonProvider({ ...specification, source: { ...source, data } }, zoom, this.#geometry);
    }).catch((error: unknown) => {
      if (!lease.signal.aborted) { throw error; }
      // SDK 的异步层会自行记录 rejection，主动取消用空提供者结束，不留下虚假的来源错误
      return createGeoJsonProvider({ ...specification,
        source: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } }, zoom);
    });
    const layer = ImageryLayer.fromProviderAsync(provider, { gamma: 1 });
    const listeners: (() => void)[] = [];
    const report = (error: unknown): void => {
      if (this.#resource === resource && !lease.signal.aborted && !isCancellation(error)) { this.#report(error); }
    };
    // SDK 在层销毁后仍可能完成 Promise；这个仅随层存活的监听吞掉过期错误，不持有外部注册
    layer.errorEvent.addEventListener(error => {
      resource.pending = false;
      report(error);
      if (this.#resource === resource) { this.#requestRender(); }
    });
    listeners.push(layer.readyEvent.addEventListener(ready => {
      if (this.#resource !== resource || lease.signal.aborted) { return; }
      resource.pending = false;
      listeners.push(ready.errorEvent.addEventListener(report));
      this.#requestRender();
    }));
    const resource: ImageryResource = {
      layer, geojson: lease, pending: true,
      unsubscribe: () => { for (const unsubscribe of listeners) { unsubscribe(); } }
    };
    return resource;
  }

  #opacity(zoom: number): number {
    if (this.#specification.type !== 'raster') {
      return 1;
    }
    const opacity = this.#specification.value('raster-opacity', zoom);
    if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      throw new RangeError('三维栅格透明度必须为 0～1');
    }
    return opacity;
  }

  #release(resource: ImageryResource): void {
    resource.unsubscribe();
    resource.mvt?.[Symbol.dispose]();
    resource.geojson?.[Symbol.dispose]();
    if (!this.#collection.remove(resource.layer, true) && !resource.layer.isDestroyed()) {
      resource.layer.destroy();
    }
  }
}

// 主动取消不是来源失败；SDK 的 TileProviderError 把原始异常放在 error 中
function isCancellation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) { return false; }
  if ('name' in error && error.name === 'AbortError') { return true; }
  return 'error' in error && error.error !== error && isCancellation(error.error);
}
