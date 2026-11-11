import type { SceneFrame, SceneRenderer, SceneSurface } from '@mx/map-core';
import type { GlError, GlWatch, ThreeSceneInspection, ThreeSceneRenderer, ThreeSceneRendererOptions } from '@mx/map-three';
import { MAPLIBRE_ENGINE, type SceneEngine } from '@mx/map-vue';

// 高斯泼溅的 GL 监听和预算（/dev/splat-watch，ADR 0149 第 2 节、L.3）：给页面造一个 maplibre 引擎，
// 渲染器是产品的 ThreeSceneRenderer，只换总预算、包住 render（GL 监听据此区分渲染回调里外），挂上时记下 GL 上下文

/** map-three 里用到的部分：测试换成假的 */
export interface MapThreeModule {
  readonly ThreeSceneRenderer: new (options?: ThreeSceneRendererOptions) => Pick<
    ThreeSceneRenderer,
    'attach' | 'render' | 'inspect'
  > &
    SceneRenderer;
  readonly watchGl: (gl: WebGL2RenderingContext, inside: () => boolean) => GlWatch;
}

/** 一份读数：页面每半秒取一次 */
export interface ProbeSnapshot {
  /** 显卡（UNMASKED_RENDERER）；还没有上下文时为 null */
  readonly gpu: string | null;
  /** 和上一份之间的帧率；第一份为 null */
  readonly fps: number | null;
  readonly inspection: ThreeSceneInspection | null;
  /** GL 监听：没开时为 null */
  readonly watch: {
    readonly seconds: number;
    readonly errorCount: number;
    readonly errors: readonly GlError[];
    readonly libraryOutside: number;
    readonly libraryOutsideByMethod: Readonly<Record<string, number>>;
  } | null;
}

const loadMapThree = (): Promise<MapThreeModule> => import('@mx/map-three');

function gpuName(gl: WebGL2RenderingContext): string {
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

export class SplatProbe implements Disposable {
  readonly #load: () => Promise<MapThreeModule>;
  #module: MapThreeModule | null = null;
  #renderer: Pick<ThreeSceneRenderer, 'inspect'> | null = null;
  #gl: WebGL2RenderingContext | null = null;
  #gpu: string | null = null;
  #inside = false;
  #watching = false;
  #watch: { readonly gl: WebGL2RenderingContext; readonly handle: GlWatch; readonly since: number } | null = null;
  #last: { readonly frames: number; readonly at: number } | null = null;

  constructor(load: () => Promise<MapThreeModule> = loadMapThree) {
    this.#load = load;
  }

  /** 这个预算的引擎：每次换预算重新建地图，拿一个新的 */
  engine(budget: number): SceneEngine {
    return {
      capabilities: MAPLIBRE_ENGINE.capabilities,
      loadRenderer: async () => {
        const module = await this.#load();
        this.#module = module;
        return () => this.#createRenderer(module, budget);
      }
    };
  }

  /** GL 监听的开关：每次调用都读错误会让 GPU 同步，开着时帧率不算数 */
  setWatching(on: boolean, now = performance.now()): void {
    this.#watching = on;
    this.#rewatch(now);
  }

  snapshot(now = performance.now()): ProbeSnapshot {
    const inspection = this.#renderer?.inspect() ?? null;
    const last = this.#last;
    const fps = inspection && last && now > last.at ? ((inspection.frames - last.frames) * 1000) / (now - last.at) : null;
    this.#last = inspection ? { frames: inspection.frames, at: now } : null;
    const watch = this.#watch;
    return {
      gpu: this.#gpu,
      fps,
      inspection,
      watch: watch && {
        seconds: (now - watch.since) / 1000,
        errorCount: watch.handle.errorCount,
        errors: [...watch.handle.errors],
        libraryOutside: watch.handle.libraryOutside,
        libraryOutsideByMethod: watch.handle.libraryOutsideByMethod
      }
    };
  }

  /** 地图卸下（换预算、离开页面）时：撤掉监听，不再读这个渲染器 */
  detach(): void {
    this.#watch?.handle[Symbol.dispose]();
    this.#watch = null;
    this.#renderer = null;
    this.#gl = null;
    this.#gpu = null;
    this.#last = null;
  }

  [Symbol.dispose](): void {
    this.detach();
  }

  #createRenderer({ ThreeSceneRenderer }: MapThreeModule, budget: number): SceneRenderer {
    const renderer = new ThreeSceneRenderer({ splatBudget: budget });
    const attach = renderer.attach.bind(renderer);
    const render = renderer.render.bind(renderer);
    renderer.attach = (surface: SceneSurface) => {
      attach(surface);
      this.#attached(renderer, surface.gl);
    };
    renderer.render = (frame: SceneFrame) => {
      this.#inside = true;
      try {
        render(frame);
      } finally {
        this.#inside = false;
      }
    };
    return renderer;
  }

  // 换了地图（换预算）时上下文也换了：旧的监听撤掉，按开关监听新的
  #attached(renderer: Pick<ThreeSceneRenderer, 'inspect'>, gl: WebGL2RenderingContext): void {
    this.#renderer = renderer;
    this.#last = null;
    if (gl !== this.#gl) {
      this.#gl = gl;
      this.#gpu = gpuName(gl);
      this.#rewatch(performance.now());
    }
  }

  #rewatch(now: number): void {
    const module = this.#module;
    const wanted = this.#watching && module ? this.#gl : null;
    if (this.#watch && this.#watch.gl !== wanted) {
      this.#watch.handle[Symbol.dispose]();
      this.#watch = null;
    }
    if (wanted && module && !this.#watch) {
      this.#watch = { gl: wanted, handle: module.watchGl(wanted, () => this.#inside), since: now };
    }
  }
}
