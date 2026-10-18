import type { GeoJSONSourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { GeoJSON, Geometry } from 'geojson';
import { z } from 'zod';
import { abortReason } from '@yzt/utils';

export interface GeoJsonLease extends Disposable {
  readonly promise: Promise<GeoJSON>;
  readonly signal: AbortSignal;
}

interface SourceEntry {
  readonly source: GeoJSONSourceSpecification;
  readonly controller: AbortController;
  readonly promise: Promise<GeoJSON>;
  readonly consumers: Set<AbortController>;
}

// 请求边界只检查 GeoJSON 的结构；投影范围和图层可绘制性由具体提供者检查
const position = z.array(z.number()).min(2);
const line = z.array(position);
const polygon = z.array(line);
const geometry: z.ZodType<Geometry> = z.lazy(() => z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('Point'), coordinates: position }),
  z.looseObject({ type: z.literal('MultiPoint'), coordinates: line }),
  z.looseObject({ type: z.literal('LineString'), coordinates: line }),
  z.looseObject({ type: z.literal('MultiLineString'), coordinates: polygon }),
  z.looseObject({ type: z.literal('Polygon'), coordinates: polygon }),
  z.looseObject({ type: z.literal('MultiPolygon'), coordinates: z.array(polygon) }),
  z.looseObject({ type: z.literal('GeometryCollection'), geometries: z.array(geometry) })
]));
const feature = z.looseObject({
  type: z.literal('Feature'),
  geometry: geometry.nullable(),
  properties: z.record(z.string(), z.unknown()).nullable(),
  id: z.union([z.string(), z.number()]).optional()
});
const geoJson = z.union([
  geometry,
  feature,
  z.looseObject({ type: z.literal('FeatureCollection'), features: z.array(feature) })
]);

/** 同一个不可变来源共用下载和解析；最后一份租约释放时撤销请求并丢弃缓存 */
export class GeoJsonSources implements Disposable {
  readonly #fetch: typeof fetch;
  readonly #sources = new WeakMap<GeoJSONSourceSpecification, SourceEntry>();
  readonly #entries = new Set<SourceEntry>();
  #disposed = false;

  constructor({ fetch: fetchSource = fetch }: { readonly fetch?: typeof fetch } = {}) {
    this.#fetch = fetchSource;
  }

  acquire(source: GeoJSONSourceSpecification): GeoJsonLease {
    if (this.#disposed) { throw new DOMException('GeoJSON 数据服务已释放', 'AbortError'); }
    if (typeof source.data !== 'string') { throw new Error('GeoJSON 来源租约只接收 URL 数据源'); }
    let entry = this.#sources.get(source);
    if (!entry) {
      const controller = new AbortController();
      const created: SourceEntry = {
        source, controller, consumers: new Set(),
        promise: this.#load(source.data, controller.signal).catch(error => {
          // 失败不缓存；旧租约仍可释放，下一次 acquire 可以独立重试
          if (this.#sources.get(source) === created) { this.#sources.delete(source); }
          throw error;
        })
      };
      entry = created;
      this.#sources.set(source, entry);
      this.#entries.add(entry);
    }
    const consumer = new AbortController();
    const { signal } = consumer;
    entry.consumers.add(consumer);
    const active = entry;
    const promise = new Promise<GeoJSON>((resolve, reject) => {
      const abort = () => reject(abortReason(signal));
      signal.addEventListener('abort', abort, { once: true });
      void active.promise.then(data => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) { return reject(abortReason(signal)); }
        return resolve(data);
      }, (error: unknown) => {
        signal.removeEventListener('abort', abort);
        const reason = signal.aborted ? abortReason(signal) : error;
        return reject(reason instanceof Error ? reason : new Error(String(reason)));
      });
    });
    return { promise, signal, [Symbol.dispose]: () => this.#release(active, consumer) };
  }

  [Symbol.dispose](): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    for (const entry of this.#entries) {
      for (const consumer of entry.consumers) { this.#release(entry, consumer); }
    }
  }

  #release(entry: SourceEntry, consumer: AbortController): void {
    if (!entry.consumers.delete(consumer)) { return; }
    consumer.abort(new DOMException('GeoJSON 来源租约已释放', 'AbortError'));
    if (entry.consumers.size === 0) {
      if (this.#sources.get(entry.source) === entry) { this.#sources.delete(entry.source); }
      this.#entries.delete(entry);
      entry.controller.abort(new DOMException('GeoJSON 来源没有使用者', 'AbortError'));
    }
  }

  async #load(url: string, signal: AbortSignal): Promise<GeoJSON> {
    // 使用局部函数调用，不能把浏览器原生 fetch 绑定到服务实例
    const fetchSource = this.#fetch;
    const response = await fetchSource(url, { signal });
    signal.throwIfAborted();
    if (!response.ok) { throw new Error(`GeoJSON 数据请求失败（${response.status}）`); }
    const data: unknown = await response.json();
    signal.throwIfAborted();
    // GeoJSON 允许 null geometry，当前 GeoJSON 联合类型未包含该 Feature 分支
    return geoJson.parse(data) as GeoJSON;
  }
}
