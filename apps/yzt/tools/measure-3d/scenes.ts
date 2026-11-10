import type { BenchCamera } from './bench-api.ts';

// 场景和方案：同一个场景的各个方案用相同的相机和飞行路径（场景和路径来自 ADR 0147 的 PoC）

// MapLibre 的缩放级口径（512 像素瓦片），同 packages/map-cesium 的 camera-math
const METERS_PER_PIXEL_AT_ZOOM_0 = 78271.516964;

export interface SceneModel {
  /** 相对 /3dt/ 的索引地址 */
  readonly path: string;
}

export interface Scene {
  readonly id: string;
  readonly title: string;
  /** ADR 0147 3C.4 的验收场景 */
  readonly acceptance: boolean;
  /** 瓦片集 */
  readonly models: readonly SceneModel[];
  /** 高斯泼溅（ADR 0149）：清单里的模型 ID，地址和摆放从清单读（splat-models.ts）；有泼溅的场景只有 MapLibre 引擎，比较预算 */
  readonly splats: readonly string[];
  /** 没有中心时用模型的建议相机（模型只在服务器上、不知道坐标时） */
  readonly camera: Omit<BenchCamera, 'center'> & { readonly center: readonly [number, number] | null };
}

/** 方案：Cesium，或者 MapLibre 引擎的某个上传预算、泼溅预算 */
export interface Variant {
  readonly id: string;
  readonly label: string;
  readonly engine: 'cesium' | 'maplibre';
  /** 每帧上传的 MB；undefined 用产品的默认值，null 不提前上传 */
  readonly uploadMB?: number | null;
  /** 相机在这个窗口里走的路达到瓦片直径就不请求（秒，auto 按实测的加载时间）；undefined 用产品的默认值，null 动着也请求 */
  readonly cullWindow?: number | 'auto' | null;
  /** 高斯泼溅的总预算（高斯个数）；undefined 用产品的默认值 */
  readonly splatBudget?: number;
}

/** 一遍：perf 量帧时间和加载，quality 拍画面，profile 带 CPU 采样 */
export type RunKind = 'perf' | 'quality' | 'profile';

export interface Run {
  readonly id: string;
  readonly scene: Scene;
  readonly variant: Variant;
  readonly kind: RunKind;
  readonly repeat: number;
}

const OBLIQUE: SceneModel = { path: 'XZ_GC_3DT/tileset.json' };
const STATION: SceneModel = { path: 'SZ_3DT/tileset.json' };
const WHITE: SceneModel = { path: 'SZ_WhiteModel/plain/tileset.json' };
const JKQ: SceneModel = { path: 'JKQ/tileset.json' };
const JKQ2: SceneModel = { path: 'JKQ2/tileset.json' };
const OBLIQUE_CENTER = [117.1807, 34.2657] as const;
const STATION_CENTER = [120.6660669, 31.317559] as const;

// 高斯泼溅（ADR 0149 L.3）的清单 ID：彭城广场的 LCC2 样例（1.66 亿个高斯）不入库，写在本地清单里，
// 楚王山1号（2334 万个）在入库的清单里。样例和 XZ 是同一处，相机也用 XZ 的中心
export const PENGCHENG_SPLAT = 'xz-pc-lcc2';
export const CHUWANGSHAN_SPLAT = 'xz-cws1';

function aerial(id: string, title: string, models: readonly SceneModel[], center: readonly [number, number], zoom: number, acceptance = false): Scene {
  return { id, title, acceptance, models, splats: [], camera: { center, zoom, pitch: 55, bearing: 20 } };
}

// 只在服务器上的模型：相机用模型的建议中心，俯视和倾斜各一个姿态
function remote(id: string, title: string, model: SceneModel, zoom: number, pitch: number): Scene {
  return { id, title, acceptance: false, models: [model], splats: [], camera: { center: null, zoom, pitch, bearing: 0 } };
}

// 高斯泼溅：中心为 null 时用模型的建议中心。比 300 万、600 万、1000 万要看得到这么多：楚王山1号最细一级只有 1187 万个，
// 所以预算主要看彭城广场的样例。库按距离分档要细节（limit），z18 俯瞰要不了 1000 万时，z19 近看、更斜的那个能用满；
// 和 XZ 一起开时倾斜模型在泼溅的范围里裁掉，显存要两者一起看
function splat(
  id: string,
  title: string,
  splats: readonly string[],
  models: readonly SceneModel[],
  center: readonly [number, number] | null,
  zoom: number,
  pitch = 55
): Scene {
  return { id, title, acceptance: false, models, splats, camera: { center, zoom, pitch, bearing: 20 } };
}

export const SCENES: readonly Scene[] = [
  aerial('oblique-z17', '倾斜摄影 z17', [OBLIQUE], OBLIQUE_CENTER, 17, true),
  aerial('oblique-z19', '倾斜摄影 z19', [OBLIQUE], OBLIQUE_CENTER, 19, true),
  aerial('white-z15.5', '白模 z15.5', [WHITE], STATION_CENTER, 15.5),
  aerial('white-station-z17', '白模加车站 z17', [WHITE, STATION], STATION_CENTER, 17),
  aerial('white-station-z18', '白模加车站 z18', [WHITE, STATION], STATION_CENTER, 18),
  remote('jkq-z16', '经开区 z16 俯视', JKQ, 16, 0),
  remote('jkq-z16-tilt', '经开区 z16 倾斜', JKQ, 16, 55),
  remote('jkq-z16.5', '经开区 z16.5 俯视', JKQ, 16.5, 0),
  remote('jkq-z17-tilt', '经开区 z17 倾斜', JKQ, 17, 55),
  remote('jkq2-z15', '经开区2 z15 俯视', JKQ2, 15, 0),
  remote('jkq2-z16-tilt', '经开区2 z16 倾斜', JKQ2, 16, 55),
  splat('splat-pc-z18', '彭城广场 LCC2 z18', [PENGCHENG_SPLAT], [], OBLIQUE_CENTER, 18),
  splat('splat-pc-z19', '彭城广场 LCC2 z19 近看', [PENGCHENG_SPLAT], [], OBLIQUE_CENTER, 19, 65),
  splat('splat-pc-xz-z18', '彭城广场 LCC2 加倾斜摄影 z18', [PENGCHENG_SPLAT], [OBLIQUE], OBLIQUE_CENTER, 18),
  splat('splat-cws1-z18', '楚王山1号 z18', [CHUWANGSHAN_SPLAT], [], null, 18)
];

/** 泼溅场景的方案：MapLibre 引擎，每个总预算一个 */
export function splatVariants(budgets: readonly number[]): Variant[] {
  return budgets.map(splatBudget => ({
    id: `maplibre-splat${splatBudget / 1e6}m`,
    label: `MapLibre，泼溅预算 ${(splatBudget / 1e4).toLocaleString('en-US')} 万`,
    engine: 'maplibre',
    splatBudget
  }));
}

/** 这个场景跑哪些方案：有泼溅的比较预算（Cesium 画不了泼溅），其余比较两种引擎 */
export const variantsOf = (scene: Scene, list: readonly Variant[], splatList: readonly Variant[]): readonly Variant[] =>
  scene.splats.length > 0 ? splatList : list;

export function variants(uploadMBs: readonly (number | null)[], cullWindows: readonly (number | 'auto' | null)[] = []): Variant[] {
  return [
    { id: 'cesium', label: 'Cesium', engine: 'cesium' },
    { id: 'maplibre', label: 'MapLibre', engine: 'maplibre' },
    ...uploadMBs.map(
      (uploadMB): Variant => ({
        id: uploadMB === null ? 'maplibre-no-budget' : `maplibre-up${uploadMB}`,
        label: uploadMB === null ? 'MapLibre，不提前上传' : `MapLibre，每帧上传 ${uploadMB} MB`,
        engine: 'maplibre',
        uploadMB
      })
    ),
    ...cullWindows.map((cullWindow): Variant => ({ ...cullVariant(cullWindow), engine: 'maplibre', cullWindow }))
  ];
}

function cullVariant(cullWindow: number | 'auto' | null): Pick<Variant, 'id' | 'label'> {
  if (cullWindow === null) {
    return { id: 'maplibre-no-cull', label: 'MapLibre，动着也请求' };
  }
  if (cullWindow === 'auto') {
    return { id: 'maplibre-cull-auto', label: 'MapLibre，动着按实测的加载时间算' };
  }
  return { id: `maplibre-cull${cullWindow}`, label: `MapLibre，动着按 ${cullWindow} 秒的路算` };
}

/**
 * 要跑的所有遍：每个场景每个方案 repeat 遍 perf；只有验收要比的两个方案多跑一遍画质和一遍采样。
 * 泼溅场景的方案是 splatList：每个预算多跑一遍采样（加载新分块时卡不卡），不比画质（没有 Cesium 可比）
 */
export function buildRuns(scenes: readonly Scene[], list: readonly Variant[], repeat: number, splatList: readonly Variant[] = []): Run[] {
  const runs: Run[] = [];
  for (let index = 0; index < repeat; index++) {
    for (const scene of scenes) {
      const own = variantsOf(scene, list, splatList);
      // 每遍换一次先后，一个方案不会总是在机器最热的时候跑
      const ordered = index % 2 === 0 ? own : own.toReversed();
      for (const variant of ordered) {
        runs.push({ id: `${scene.id}/${variant.id}/perf-${index + 1}`, scene, variant, kind: 'perf', repeat: index });
      }
    }
  }
  for (const scene of scenes) {
    for (const variant of variantsOf(scene, list, splatList)) {
      const splatScene = scene.splats.length > 0;
      if (!splatScene && (variant.id === 'cesium' || variant.id === 'maplibre')) {
        runs.push({ id: `${scene.id}/${variant.id}/quality`, scene, variant, kind: 'quality', repeat: 0 });
      }
      if (splatScene || variant.id === 'cesium' || variant.id === 'maplibre') {
        runs.push({ id: `${scene.id}/${variant.id}/profile`, scene, variant, kind: 'profile', repeat: 0 });
      }
    }
  }
  return runs;
}

function offset([lng, lat]: readonly [number, number], east: number, north: number): readonly [number, number] {
  const radians = Math.PI / 180;
  return [lng + east / (111320 * Math.cos(lat * radians)), lat + north / 110950];
}

/** 飞一圈回到原点：平移、缩放、俯仰都变，方位转满 360° */
export function aerialFlight({ center, zoom, pitch, bearing }: BenchCamera, viewportHeight: number): BenchCamera[] {
  const span = (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((center[1] * Math.PI) / 180) * viewportHeight) / 2 ** zoom;
  // 俯视时俯仰只往大的方向变：负的俯角没有意义
  const tilt = (delta: number) => Math.max(0, pitch + delta);
  return [
    { center, zoom, pitch, bearing },
    { center: offset(center, 0.35 * span, 0.2 * span), zoom: zoom + 0.5, pitch: tilt(10), bearing: bearing + 90 },
    { center: offset(center, -0.3 * span, 0.4 * span), zoom: zoom - 0.4, pitch: tilt(-10), bearing: bearing + 180 },
    { center: offset(center, -0.2 * span, -0.35 * span), zoom: zoom + 0.3, pitch: tilt(5), bearing: bearing + 270 },
    { center, zoom, pitch, bearing: bearing + 360 }
  ];
}

/** 按子串选场景；没写时选验收场景 */
export function selectScenes(only: readonly string[]): Scene[] {
  if (only.length === 0) {
    return SCENES.filter(scene => scene.acceptance);
  }
  return SCENES.filter(scene => only.some(pattern => scene.id.includes(pattern)));
}
