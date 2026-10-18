import { GeographicTilingScheme, ImageryLayer, UrlTemplateImageryProvider } from 'cesium';
import type { ImageryLayerCollection, ImageryProvider } from 'cesium';
import { safeReporter } from '@yzt/utils';
import { createGeoJsonProvider } from './geojson-provider';
import { createRasterProvider } from './raster-provider';
import type { StyleMirrorLayer, StyleMirrorPort } from './style-mirror';
import type { BasicStyleLayer } from './style-plan';

interface ImageryStylePortOptions {
  readonly layers: ImageryLayerCollection;
  readonly requestRender: () => void;
}

interface ImageryResource {
  readonly layer: ImageryLayer;
  readonly unsubscribe: () => void;
}

// 最底层必须覆盖全球，避免 SDK 把局部影像的边缘拉伸到其他区域
const TRANSPARENT_PIXEL = 'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==';

/** 所有基础图层进入同一个影像集合，跨栅格与 GeoJSON 保持会话的层序 */
export function createImageryStylePort({ layers, requestRender }: ImageryStylePortOptions): StyleMirrorPort {
  const owned = new Set<ImageryStyleLayer>();
  let anchor: ImageryLayer | undefined;

  // 没有业务层时一起移除锚定影像，生命周期不溢出镜像的拥有范围
  function removeUnusedAnchor(): void {
    if (owned.size === 0 && anchor) {
      const current = anchor;
      anchor = undefined;
      layers.remove(current, true);
    }
  }

  return {
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
        const handle = new ImageryStyleLayer(layer, zoom, layers, onError, () => {
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
    requestRender
  };
}

/** 一个会话图层对应一个可替换的影像资源，缩放重画仍保留 handle 身份 */
class ImageryStyleLayer implements StyleMirrorLayer {
  readonly #specification: BasicStyleLayer;
  readonly #collection: ImageryLayerCollection;
  readonly #report: (error: unknown) => void;
  readonly #onDispose: () => void;
  #resource: ImageryResource | undefined;
  #zoom: number;

  constructor(
    layer: BasicStyleLayer,
    zoom: number,
    collection: ImageryLayerCollection,
    onError: (error: unknown) => void,
    onDispose: () => void
  ) {
    this.#specification = layer;
    this.#collection = collection;
    this.#report = safeReporter(onError, 'ImageryStyleLayer');
    this.#onDispose = onDispose;
    this.#zoom = zoom;
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

  setVisible(visible: boolean): void {
    if (this.#resource) {
      this.#resource.layer.show = visible;
    }
  }

  setZoom(zoom: number): void {
    const previous = this.#resource;
    if (!previous || zoom === this.#zoom) {
      return;
    }
    if (this.#specification.type === 'raster') {
      previous.layer.alpha = this.#opacity(zoom);
    } else if (this.#specification.type !== 'background' || this.#specification.zoomDependent) {
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
      this.#release(previous);
    }
    this.#zoom = zoom;
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
    let provider: ImageryProvider;
    if (specification.type === 'raster') {
      if (specification.source?.type !== 'raster') {
        throw new Error('三维栅格图层缺少栅格数据源');
      }
      provider = createRasterProvider(specification.source);
    } else {
      provider = createGeoJsonProvider(specification, zoom);
    }
    // 全球矩形参与求交会截短跨 180° 经线的范围，直接沿用提供者的范围
    const layer = new ImageryLayer(provider, {
      rectangle: provider.rectangle,
      alpha: this.#opacity(zoom), brightness: 1, contrast: 1, hue: 0, saturation: 1, gamma: 1
    });
    const resource: ImageryResource = {
      layer,
      unsubscribe: provider.errorEvent.addEventListener((error: unknown) => {
        if (this.#resource === resource) {
          this.#report(error);
        }
      })
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
    if (!this.#collection.remove(resource.layer, true) && !resource.layer.isDestroyed()) {
      resource.layer.destroy();
    }
  }
}
