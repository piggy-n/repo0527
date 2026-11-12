// 探针要最先执行（第一个导入）：它接管 requestAnimationFrame，引擎是动态导入的，一定在它之后
import { probe } from './probe.ts';
import { type CameraState, MapSession, type MapView, type SplatLayer, type StyleGroup, type TilesetLayer } from '@mx/map-core';
import type { BenchCamera, BenchStats } from '../bench-api.ts';
import { GRID_COLS, GRID_ROWS, type SharpnessGrid, sharpnessGrid } from '../sharpness.ts';
import { showReadout } from './look.ts';
import { decodeShot } from './shots.ts';

// 测量页：只有底图和模型，没有面板、定时器和业务图层，不让页面自己的工作混进测量。
// 走真实的会话、视图和引擎（ADR 0147 第 7 节：性能要测生产代码），这里不写层、场景和缓存算法。
// 参数都在地址上：models、splats、center、zoom、pitch、bearing、basemap、uploadMB、cullWindow、splatBudget、cacheGB、antialias、pacing、fps，
// --look 时还有 look、label

/** 地址上的 splats（JSON）：清单里的泼溅，地址相对 /3dt/（splat-models.ts） */
interface SplatParam {
  readonly id: string;
  readonly path: string;
  readonly placement: SplatLayer['placement'];
}

/** 引擎交给测量页的（engine-maplibre.ts） */
export interface EngineHandle {
  readonly view: MapView;
  readonly config: Readonly<Record<string, unknown>>;
  stats(): BenchStats;
  isStable(): boolean;
  frames(): number;
  requestFrame(): void;
}

export interface EngineOptions {
  readonly session: MapSession<'basemap'>;
  readonly container: HTMLElement;
  readonly params: URLSearchParams;
  /** 要加载几份泼溅：都读到索引、到齐了才算稳定 */
  readonly splatCount: number;
  readonly onError: (error: unknown) => void;
}

/** 测量脚本用的接口 */
export interface BenchApi {
  readonly config: Readonly<Record<string, unknown>>;
  /** 开始加载模型的时刻（performance.now） */
  readonly loadStartedAt: number;
  readonly errors: string[];
  /** 模型的瓦片都到了，引擎也不再调整 */
  isStable(): boolean;
  basemapIdle(): boolean;
  /** 等待期间让引擎继续更新 */
  tick(): void;
  /** 打开后每帧都重画，静止时的帧时间才是完整一帧的成本 */
  setContinuous(on: boolean): void;
  setCamera(camera: BenchCamera): void;
  setModelVisible(visible: boolean): void;
  renders(): number;
  stats(): BenchStats;
  /** 当前相机（模型的建议相机可能换过中心） */
  camera(): CameraState;
  /** 算一张截图按格的清晰度 */
  sharpnessOf(base64: string): Promise<SharpnessGrid>;
}

window.benchProbe = probe;

const params = new URLSearchParams(location.search);
const errors: string[] = [];
const report = (error: unknown) => {
  errors.push(String(error).slice(0, 300));
};
window.addEventListener('error', event => report(`window: ${event.message}`));
window.addEventListener('unhandledrejection', event => report(`rejection: ${String(event.reason)}`));

const number = (name: string, fallback: number) => {
  const value = params.get(name);
  return value === null ? fallback : Number(value);
};

function basemap(): StyleGroup {
  const background = { id: 'background', type: 'background' as const, paint: { 'background-color': '#20262c' } };
  if (params.get('basemap') === 'none') {
    return { sources: {}, layers: [background] };
  }
  return {
    sources: {
      img: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19
      }
    },
    layers: [background, { id: 'img', type: 'raster', source: 'img' }]
  };
}

const container = document.querySelector<HTMLElement>('#map');
if (!container) {
  throw new Error('缺少容器');
}

const centerText = params.get('center');
const [lng, lat] = (centerText ?? '117.1807,34.2657').split(',').map(Number);
const initialCamera: CameraState = {
  center: [lng ?? 0, lat ?? 0],
  zoom: number('zoom', 16),
  pitch: number('pitch', 0),
  bearing: number('bearing', 0)
};

const session = new MapSession<'basemap'>({ groups: ['basemap'], camera: initialCamera });
session.style.setGroup('basemap', basemap());

const splatParams = JSON.parse(params.get('splats') ?? '[]') as readonly SplatParam[];
const options: EngineOptions = { session, container, params, splatCount: splatParams.length, onError: report };
const handle = await (await import('./engine-maplibre.ts')).startMapLibre(options);
const { view } = handle;

let settled = false;
view.on('settle', () => {
  settled = true;
});

// 和泼溅一起开的倾斜模型在泼溅的范围里裁掉，同现状底图（ADR 0149 第 1 节）
const tilesets = (show: boolean): TilesetLayer[] =>
  (params.get('models') ?? '').split(',').filter(Boolean).map(path => ({
    id: path,
    url: new URL(`/3dt/${path}`, location.href).href,
    show,
    lighting: 'sun',
    clippedBySplats: splatParams.length > 0,
    attempt: 0
  }));

const splats = (show: boolean): SplatLayer[] =>
  splatParams.map(({ id, path, placement }) => ({
    id,
    url: new URL(`/3dt/${path}`, location.href).href,
    show,
    placement,
    attempt: 0
  }));

const sceneContent = (show: boolean) => ({ tilesets: tilesets(show), splats: splats(show), underground: null });

let continuous = false;
const keepDrawing = () => {
  if (continuous) {
    handle.requestFrame();
    window.requestAnimationFrame(keepDrawing);
  }
};

const setCamera = (camera: BenchCamera) => view.flyTo({ ...camera, center: [camera.center[0], camera.center[1]] }, { duration: 0 });

// 模型只在服务器上、不知道坐标时（center 没写）：就绪后用模型建议相机的落点（模型在空中时不在它正下方）
if (!centerText) {
  let placed = false;
  view.onSceneStatusChange?.(status => {
    if (placed) {
      return;
    }
    for (const item of status.values()) {
      if (item.state === 'ready') {
        placed = true;
        setCamera({ ...initialCamera, center: item.camera.center });
        break;
      }
    }
  });
}

const loadStartedAt = performance.now();
session.scene.set(sceneContent(true));

window.bench = {
  config: handle.config,
  loadStartedAt,
  errors,
  isStable: () => handle.isStable(),
  basemapIdle: () => params.get('basemap') === 'none' || settled,
  tick: () => handle.requestFrame(),
  setContinuous(on) {
    if (on !== continuous) {
      continuous = on;
      keepDrawing();
    }
  },
  setCamera,
  setModelVisible(visible) {
    session.scene.set(sceneContent(visible));
    handle.requestFrame();
  },
  renders: () => handle.frames(),
  stats: () => handle.stats(),
  camera: () => session.camera.current,
  sharpnessOf: async base64 => sharpnessGrid(await decodeShot(base64), GRID_COLS, GRID_ROWS)
};
// --look：不测量，人在窗口里看，左上角显示读数
if (params.get('look') === '1') {
  showReadout(params.get('label') ?? '', () => handle.stats(), () => session.camera.current);
}
window.benchReady = true;
