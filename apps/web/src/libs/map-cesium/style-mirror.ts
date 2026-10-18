import type { SourceSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { NO_SOURCE_ERRORS, type CameraModel, type SourceErrors, type StyleModel } from '@yzt/map-core';
import { safeReporter } from '@yzt/utils';
import { compileStylePlan, type BasicStyleLayer } from './style-plan';

/** 一层已创建的引擎资源，拥有者负责释放 */
export interface StyleMirrorLayer extends Disposable {
  setVisible(visible: boolean): void;
  setZoom(zoom: number): void;
}

/** 同步流程只依赖层的生命周期和顺序，不接触原生引擎 */
export interface StyleMirrorPort {
  /** onError 只报告提供者的加载失败；创建和更新的同步异常作为图层诊断 */
  create(layer: BasicStyleLayer, zoom: number, onError: (error: unknown) => void): StyleMirrorLayer;
  order(layers: readonly StyleMirrorLayer[]): void;
  requestRender(): void;
}

export interface StyleMirrorOptions {
  readonly style: StyleModel<string>;
  readonly camera: CameraModel;
  readonly port: StyleMirrorPort;
  readonly onError?: (error: unknown) => void;
  readonly onSourceErrors?: (errors: SourceErrors) => void;
}

interface LayerEntry {
  readonly layer: BasicStyleLayer;
  handle?: StyleMirrorLayer;
  live: boolean;
  zoom: number;
  visible?: boolean;
  reported: boolean;
}

/** 将会话的最新样式增量映射为引擎层；暂停期间只保留会话状态 */
export class StyleMirror implements Disposable {
  readonly #style: StyleModel<string>;
  readonly #camera: CameraModel;
  readonly #port: StyleMirrorPort;
  readonly #report: (error: unknown) => void;
  readonly #notifySourceErrors: (error: unknown) => void;
  readonly #unsubscribe: (() => void)[];
  readonly #entries = new Map<string, LayerEntry>();
  readonly #reportedIssues = new Set<string>();
  #sources: Readonly<Record<string, SourceSpecification>> = {};
  #sourceErrors: SourceErrors = NO_SOURCE_ERRORS;
  #ordered: readonly StyleMirrorLayer[] = [];
  #revision = -1;
  #zoom: number | undefined;
  #paused = false;
  #disposed = false;
  #syncing = false;

  constructor({ style, camera, port, onError = console.error, onSourceErrors }: StyleMirrorOptions) {
    this.#style = style;
    this.#camera = camera;
    this.#port = port;
    this.#report = safeReporter(onError, 'StyleMirror');
    this.#notifySourceErrors = safeReporter(() => onSourceErrors?.(this.#sourceErrors), 'StyleMirror.sourceErrors');
    this.#unsubscribe = [
      style.on('change', () => this.#refresh()),
      camera.on('change', ({ state }) => {
        if (state.zoom !== this.#zoom) {
          this.#refresh();
        }
      })
    ];
    this.#refresh();
  }

  get sourceErrors(): SourceErrors {
    return this.#sourceErrors;
  }

  pause(): void {
    this.#paused = true;
  }

  resume(): void {
    if (this.#disposed) {
      return;
    }
    this.#paused = false;
    this.#refresh();
  }

  [Symbol.dispose](): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const unsubscribe of this.#unsubscribe) {
      this.#attempt(unsubscribe);
    }
    // 先作废全部身份，释放时触发的迟到回调不能重新写入错误记录
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    this.#ordered = [];
    this.#sourceErrors = NO_SOURCE_ERRORS;
    for (const entry of entries) {
      this.#release(entry);
    }
  }

  #refresh(): void {
    if (this.#syncing || !this.#canWrite()) {
      return;
    }
    this.#syncing = true;
    try {
      // 外部报告回调可能同步修改会话；每轮结束重新读取，只收敛最新快照
      while (this.#canWrite()) {
        const revision = this.#style.revision;
        const zoom = this.#camera.current.zoom;
        if (this.#revision !== revision) {
          this.#syncStyle(this.#style.current, revision, zoom);
        } else if (this.#zoom !== zoom) {
          this.#syncZoom(zoom);
        } else {
          break;
        }
      }
    } finally {
      this.#syncing = false;
    }
  }

  #syncStyle(style: StyleSpecification, revision: number, zoom: number): void {
    const plan = compileStylePlan(style);
    this.#forgetChangedSources(style.sources);
    if (!this.#canWrite()) {
      return;
    }
    const next = new Map(plan.layers.map(layer => [layer.id, layer]));
    for (const [id, entry] of this.#entries) {
      const layer = next.get(id);
      if (layer?.specification !== entry.layer.specification || layer?.source !== entry.layer.source) {
        this.#entries.delete(id);
        this.#release(entry);
        if (!this.#canWrite()) {
          return;
        }
      }
    }
    for (const issue of plan.issues) {
      const message = issue.error instanceof Error ? issue.error.message : String(issue.error);
      const key = JSON.stringify([issue.layerId, message]);
      if (!this.#reportedIssues.has(key)) {
        this.#reportedIssues.add(key);
        this.#report(new Error(`图层 "${issue.layerId}"：${message}`, { cause: issue.error }));
        if (!this.#canWrite()) {
          return;
        }
      }
    }
    for (const layer of plan.layers) {
      let entry = this.#entries.get(layer.id);
      if (!entry) {
        entry = { layer, zoom, live: true, reported: false };
        // 在 create 前登记，构造资源时同步发生的加载错误也属于这次创建
        this.#entries.set(layer.id, entry);
        const current = entry;
        try {
          const handle = this.#port.create(layer, zoom, error => this.#recordError(current, error));
          if (!this.#canWrite() || !current.live) {
            this.#entries.delete(layer.id);
            current.live = false;
            this.#attempt(() => handle[Symbol.dispose]());
            return;
          }
          entry.handle = handle;
        } catch (error) {
          this.#recordError(entry, error, false);
          this.#entries.delete(layer.id);
          this.#release(entry);
        }
      }
      if (!this.#canWrite()) {
        return;
      }
      this.#apply(entry, zoom);
      if (!this.#canWrite()) {
        return;
      }
    }
    this.#reorder(plan.layers.map(layer => this.#entries.get(layer.id)?.handle).filter(handle => handle !== undefined));
    if (!this.#canWrite()) {
      return;
    }
    this.#revision = revision;
    this.#zoom = zoom;
    this.#attempt(() => this.#port.requestRender());
  }

  #syncZoom(zoom: number): void {
    for (const entry of this.#entries.values()) {
      this.#apply(entry, zoom);
      if (!this.#canWrite()) {
        return;
      }
    }
    const live = new Set([...this.#entries.values()].map(entry => entry.handle));
    this.#reorder(this.#ordered.filter(handle => live.has(handle)));
    if (!this.#canWrite()) {
      return;
    }
    this.#zoom = zoom;
    this.#attempt(() => this.#port.requestRender());
  }

  #apply(entry: LayerEntry, zoom: number): void {
    const handle = entry.handle;
    if (!handle) {
      return;
    }
    try {
      if (entry.zoom !== zoom) {
        handle.setZoom(zoom);
        entry.zoom = zoom;
      }
      if (!this.#canWrite()) {
        return;
      }
      const visible = entry.layer.visible(zoom);
      if (entry.visible !== visible) {
        handle.setVisible(visible);
        entry.visible = visible;
      }
    } catch (error) {
      this.#recordError(entry, error, false);
      this.#entries.delete(entry.layer.id);
      this.#release(entry);
    }
  }

  #reorder(handles: readonly StyleMirrorLayer[]): void {
    if (handles.length === this.#ordered.length && handles.every((handle, index) => handle === this.#ordered[index])) {
      return;
    }
    this.#attempt(() => {
      this.#port.order(handles);
      this.#ordered = handles;
    });
  }

  #forgetChangedSources(sources: Readonly<Record<string, SourceSpecification>>): void {
    const errors = [...this.#sourceErrors].filter(([id]) => sources[id] !== undefined && sources[id] === this.#sources[id]);
    this.#sources = sources;
    if (errors.length !== this.#sourceErrors.size) {
      this.#sourceErrors = errors.length > 0 ? new Map(errors) : NO_SOURCE_ERRORS;
      this.#notifySourceErrors(this.#sourceErrors);
    }
  }

  #recordError(entry: LayerEntry, error: unknown, sourceFailure = true): void {
    if (this.#disposed || !entry.live || this.#entries.get(entry.layer.id) !== entry) {
      return;
    }
    const style = this.#style.current;
    const { sourceId, source, specification } = entry.layer;
    if (style.layers.find(layer => layer.id === entry.layer.id) !== specification ||
      (sourceId !== undefined && style.sources[sourceId] !== source)) {
      return;
    }
    if (sourceFailure && sourceId !== undefined && !this.#sourceErrors.has(sourceId)) {
      this.#sourceErrors = new Map([...this.#sourceErrors, [sourceId, error]]);
      this.#notifySourceErrors(this.#sourceErrors);
    }
    if (!this.#disposed && !entry.reported) {
      entry.reported = true;
      this.#report(error);
    }
  }

  #release(entry: LayerEntry): void {
    entry.live = false;
    const handle = entry.handle;
    entry.handle = undefined;
    if (handle) {
      this.#attempt(() => handle[Symbol.dispose]());
    }
  }

  #attempt(action: () => void): void {
    try {
      action();
    } catch (error) {
      this.#report(error);
    }
  }

  #canWrite(): boolean {
    return !this.#disposed && !this.#paused;
  }
}
