import type { BenchCamera } from './bench-api.ts';

// 场景和方案：同一个场景的各个方案用相同的相机和飞行路径（场景和路径来自 ADR 0147 的 PoC）

// MapLibre 的缩放级口径（512 像素瓦片）：z0 时赤道上每像素的米数
const METERS_PER_PIXEL_AT_ZOOM_0 = 78271.516964;

export interface SceneModel {
  /** 相对 /3dt/ 的索引地址，中文照写：本机按它找文件，请求时由 URL 编码 */
  readonly path: string;
}

export interface Scene {
  readonly id: string;
  readonly title: string;
  /** 没写 --only 时跑的场景 */
  readonly byDefault: boolean;
  /** 瓦片集 */
  readonly models: readonly SceneModel[];
  /** 高斯泼溅（ADR 0149）：清单里的模型 ID，地址和摆放从清单读（splat-models.ts）；有泼溅的场景比较预算 */
  readonly splats: readonly string[];
  /** 没有中心时用模型的建议相机（模型只在服务器上、不知道坐标时） */
  readonly camera: Omit<BenchCamera, 'center'> & { readonly center: readonly [number, number] | null };
}

/** 方案：产品的默认值，或者另外对照的某个上传预算、动着不请求的窗口、缓存上限、泼溅预算 */
export interface Variant {
  readonly id: string;
  readonly label: string;
  /** 每帧上传的 MB；undefined 用产品的默认值，null 不提前上传 */
  readonly uploadMB?: number | null;
  /** 相机在这个窗口里走的路达到瓦片直径就不请求（秒，auto 按实测的加载时间）；undefined 用产品的默认值，null 动着也请求 */
  readonly cullWindow?: number | 'auto' | null;
  /** 瓦片缓存的上限（GB）：到它不再加载，淘汰到它的一半；undefined 用产品的默认值（1 GB + 1 GB） */
  readonly cacheGB?: number;
  /** 贴图上传以后释放内存里的那份（ADR 0155 第 5 节的对比，只在测量页里做） */
  readonly releaseImages?: boolean;
  /** 高斯泼溅的总预算（高斯个数）；undefined 用产品的默认值 */
  readonly splatBudget?: number;
}

/** 产品默认设置的方案：采样和检查只看它，画质另外给缓存上限的各档跑（比清晰度），其余方案只跑 perf 对照 */
export const DEFAULT_VARIANT = 'maplibre';

/** 这个方案也跑画质：产品的默认值，和比较缓存上限的各档（同一相机的截图和默认值比）；释放贴图的画面不变，不跑 */
export const takesQualityRun = (variant: Variant): boolean =>
  !variant.releaseImages && (variant.id === DEFAULT_VARIANT || variant.cacheGB !== undefined);

/** 一遍：perf 量帧时间和加载，quality 拍画面，profile 带 CPU 采样，zoom 是定位后放大一级（--zoom-in） */
export type RunKind = 'perf' | 'quality' | 'profile' | 'zoom';

export interface Run {
  readonly id: string;
  readonly scene: Scene;
  readonly variant: Variant;
  readonly kind: RunKind;
  readonly repeat: number;
}

// 目录的层级同清单（docs/config/3dt-manifest.md）；经开区2 不在清单里了，数据还在服务器上
const OBLIQUE: SceneModel = { path: 'xuzhou/3dtiles/彭城广场/tileset.json' };
const STATION: SceneModel = { path: 'suzhou/3dtiles/星海广场站/tileset.json' };
const WHITE: SceneModel = { path: 'suzhou/3dtiles/星海广场站周边建筑白模/plain/tileset.json' };
const JKQ: SceneModel = { path: 'wuxi/3dtiles/经开区/tileset.json' };
const JKQ2: SceneModel = { path: 'wuxi/3dtiles/经开区2/tileset.json' };
const XWQ02: SceneModel = { path: 'wuxi/3dtiles/新吴区02/tileset.json' };
const XWQ03: SceneModel = { path: 'wuxi/3dtiles/新吴区03/tileset.json' };
const OBLIQUE_CENTER = [117.1807, 34.2657] as const;
const STATION_CENTER = [120.6660669, 31.317559] as const;

// 高斯泼溅（ADR 0149 L.3）的清单 ID，都在入库的清单里：彭城广场（泼溅）就是 L.2、L.3 用的样例（1.66 亿个高斯），
// 楚王山1号 2334 万个。样例和 XZ 是同一处，相机也用 XZ 的中心
export const PENGCHENG_SPLAT = 'xz-pc-lcc2';
export const CHUWANGSHAN_SPLAT = 'xz-cws1';

function aerial(id: string, title: string, models: readonly SceneModel[], center: readonly [number, number], zoom: number, byDefault = false): Scene {
  return { id, title, byDefault, models, splats: [], camera: { center, zoom, pitch: 55, bearing: 20 } };
}

// 只在服务器上的模型：相机用模型建议相机的落点（模型在空中时不在它正下方），俯视和倾斜各一个姿态
function remote(id: string, title: string, model: SceneModel, zoom: number, pitch: number): Scene {
  return { id, title, byDefault: false, models: [model], splats: [], camera: { center: null, zoom, pitch, bearing: 0 } };
}

// 高斯泼溅：中心为 null 时用模型的建议中心；楚王山1号 z18 这个视角要不了 600 万以上，场景为什么这样选见 map-three.md 的"泼溅的预算"
function splat(
  id: string,
  title: string,
  splats: readonly string[],
  models: readonly SceneModel[],
  center: readonly [number, number] | null,
  zoom: number,
  pitch = 55
): Scene {
  return { id, title, byDefault: false, models, splats, camera: { center, zoom, pitch, bearing: 20 } };
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
  // 新吴区02、03 的结构和经开区一样（根 → top/0.json → Tile_*），姿态也一样：看屏幕误差 8 下放不放得下
  remote('xwq02-z16', '新吴区02 z16 俯视', XWQ02, 16, 0),
  remote('xwq02-z16-tilt', '新吴区02 z16 倾斜', XWQ02, 16, 55),
  remote('xwq02-z16.5', '新吴区02 z16.5 俯视', XWQ02, 16.5, 0),
  remote('xwq02-z17-tilt', '新吴区02 z17 倾斜', XWQ02, 17, 55),
  remote('xwq03-z16', '新吴区03 z16 俯视', XWQ03, 16, 0),
  remote('xwq03-z16-tilt', '新吴区03 z16 倾斜', XWQ03, 16, 55),
  remote('xwq03-z16.5', '新吴区03 z16.5 俯视', XWQ03, 16.5, 0),
  remote('xwq03-z17-tilt', '新吴区03 z17 倾斜', XWQ03, 17, 55),
  splat('splat-pc-z18', '彭城广场 LCC2 z18', [PENGCHENG_SPLAT], [], OBLIQUE_CENTER, 18),
  splat('splat-pc-z19', '彭城广场 LCC2 z19 近看', [PENGCHENG_SPLAT], [], OBLIQUE_CENTER, 19, 65),
  splat('splat-pc-xz-z18', '彭城广场 LCC2 加倾斜摄影 z18', [PENGCHENG_SPLAT], [OBLIQUE], OBLIQUE_CENTER, 18),
  splat('splat-cws1-z18', '楚王山1号 z18', [CHUWANGSHAN_SPLAT], [], null, 18)
];

/** 泼溅场景的方案：每个总预算一个 */
export function splatVariants(budgets: readonly number[]): Variant[] {
  return budgets.map(splatBudget => ({
    id: `maplibre-splat${splatBudget / 1e6}m`,
    label: `MapLibre，泼溅预算 ${(splatBudget / 1e4).toLocaleString('en-US')} 万`,
    splatBudget
  }));
}

/** 这个场景跑哪些方案：有泼溅的比较泼溅预算，其余是产品的默认值和另外对照的上传预算、窗口 */
export const variantsOf = (scene: Scene, list: readonly Variant[], splatList: readonly Variant[]): readonly Variant[] =>
  scene.splats.length > 0 ? splatList : list;

/** 释放贴图的方案 id 带这个后缀：机器状态按去掉它以后的方案分组（verdict.ts），画的一样 */
export const RELEASE_SUFFIX = '-release';

export function variants(
  uploadMBs: readonly (number | null)[],
  cullWindows: readonly (number | 'auto' | null)[] = [],
  cacheGBs: readonly number[] = [],
  releaseImages = false
): Variant[] {
  const defaults: Variant = { id: DEFAULT_VARIANT, label: 'MapLibre' };
  const tiers = cacheGBs.map((cacheGB): Variant => ({ id: `maplibre-cache${cacheGB}g`, label: `MapLibre，缓存上限 ${cacheGB} GB`, cacheGB }));
  // 释放贴图：产品的默认值和缓存上限的每一档各一个对照，和原来的方案比内存
  const released = releaseImages
    ? [defaults, ...tiers].map(
        (base): Variant => Object.assign({}, base, { id: `${base.id}${RELEASE_SUFFIX}`, label: `${base.label}，上传后释放贴图`, releaseImages: true })
      )
    : [];
  return [
    defaults,
    ...uploadMBs.map(
      (uploadMB): Variant => ({
        id: uploadMB === null ? 'maplibre-no-budget' : `maplibre-up${uploadMB}`,
        label: uploadMB === null ? 'MapLibre，不提前上传' : `MapLibre，每帧上传 ${uploadMB} MB`,
        uploadMB
      })
    ),
    ...cullWindows.map((cullWindow): Variant => ({ ...cullVariant(cullWindow), cullWindow })),
    ...tiers,
    ...released
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
 * 要跑的所有遍：每个场景每个方案 repeat 遍 perf；产品的默认值多跑一遍画质和一遍采样，缓存上限的各档多跑一遍画质，
 * zoomIn 时跑画质的方案再多跑一遍定位后放大一级。泼溅场景的方案是 splatList：每个预算多跑一遍采样（加载新分块时卡不卡），
 * 不跑画质
 */
export function buildRuns(
  scenes: readonly Scene[],
  list: readonly Variant[],
  repeat: number,
  splatList: readonly Variant[] = [],
  zoomIn = false
): Run[] {
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
      if (!splatScene && takesQualityRun(variant)) {
        runs.push({ id: `${scene.id}/${variant.id}/quality`, scene, variant, kind: 'quality', repeat: 0 });
        if (zoomIn) {
          runs.push({ id: `${scene.id}/${variant.id}/zoom`, scene, variant, kind: 'zoom', repeat: 0 });
        }
      }
      if (splatScene || variant.id === DEFAULT_VARIANT) {
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

// 视口的高度在地面上是多少米（按中心的纬度）
const viewSpan = ({ center, zoom }: BenchCamera, viewportHeight: number) =>
  (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((center[1] * Math.PI) / 180) * viewportHeight) / 2 ** zoom;

/** 飞一圈回到原点：平移、缩放、俯仰都变，方位转满 360° */
export function aerialFlight(camera: BenchCamera, viewportHeight: number): BenchCamera[] {
  const { center, zoom, pitch, bearing } = camera;
  const span = viewSpan(camera, viewportHeight);
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

/** 定位后放大一级：中心、俯仰、方位不变 */
export const zoomedIn = (camera: BenchCamera): BenchCamera => ({ ...camera, zoom: camera.zoom + 1 });

/**
 * 移开再移回同一个相机，像用户动一下相机：往东走一个视口高度（地面上）再回来。相机离地约是它的 1.5 × cos(俯角) 倍，
 * 走的路远超高度的 25%，锁定一定解开、停下后重新判断（ADR 0147 第 5 节的姿态锁定）
 */
export function nudge(camera: BenchCamera, viewportHeight: number): BenchCamera[] {
  return [camera, { ...camera, center: offset(camera.center, viewSpan(camera, viewportHeight), 0) }, camera];
}

/** --at：场景换成这个相机，模型和方案不变；id 不变，标题注明（结果的 meta.at 里有相机） */
export function withCamera(scene: Scene, camera: BenchCamera): Scene {
  return { ...scene, title: `${scene.title}（--at 的相机）`, camera };
}

/**
 * 按子串选场景；没写时选默认的场景。写出完整的场景 ID 时只选它（jkq-z16 不带上 jkq-z16-tilt、jkq-z16.5）。
 * 泼溅场景要写出 splat 才选得中：--only z19 不带上比预算的泼溅场景
 */
export function selectScenes(only: readonly string[]): Scene[] {
  if (only.length === 0) {
    return SCENES.filter(scene => scene.byDefault);
  }
  const ids = new Set(SCENES.map(scene => scene.id));
  return SCENES.filter(scene =>
    only.some(pattern =>
      ids.has(pattern) ? scene.id === pattern : scene.id.includes(pattern) && (scene.splats.length === 0 || pattern.includes('splat'))
    )
  );
}
