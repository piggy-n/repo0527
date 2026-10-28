import type {
  Navigation,
  NavPoint,
  SceneContent,
  SceneRoam,
  TilesetLayer,
  TilesetStatus,
  WalkView
} from '@yzt/map-core';
import type { SceneModel } from './catalog';

/** 漫游地下的模型时地表的不透明度（ADR 0097 第 5 节：没有单独的钻地，不能调） */
export const SURFACE_OPACITY = 0.25;

/** 路线漫游（ADR 0083）：哪个模型的哪条路线；id 每次开始换一个，run 是第几遍；速度是米/秒（ADR 0097 第 4 节） */
export interface RouteChoice {
  readonly kind: 'route';
  readonly modelId: string;
  readonly routeId: string;
  readonly id: string;
  readonly playing: boolean;
  readonly speed: number;
  readonly run: number;
}

/**
 * 步行（ADR 0086）：哪个模型、速度（米/秒），回到出生点、脱困的次数；完整地图打开时暂停，在上面双击的瞬移（ADR 0087）；
 * 人称（ADR 0090）。导航网格建好以前不交给会话
 */
export interface WalkChoice {
  readonly kind: 'walk';
  readonly modelId: string;
  readonly id: string;
  readonly speed: number;
  readonly respawn: number;
  readonly unstuck: number;
  readonly paused: boolean;
  readonly teleport: { readonly count: number; readonly spot: NavPoint } | null;
  readonly view: WalkView;
}

export type RoamChoice = RouteChoice | WalkChoice;

/**
 * 第三人称的人物模型（ADR 0090 第 4 节）：Cesium 官方示例模型 Cesium Man，随应用部署在 `${BASE_URL}roam/` 下，
 * 来源和许可见 docs/modules/map-cesium.md
 */
export function walkAvatarUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}roam/Cesium_Man.glb`, window.location.href).href;
}

/** 漫游速度的档位（米/秒）：步行和路线共用，面板上逐档调（ADR 0097 第 4 节） */
export const ROAM_SPEEDS: readonly number[] = [0.5, 1, 1.6, 2.5, 4, 6, 8];
/** 第一次漫游的速度（ADR 0094），之后几次漫游、两种方式之间沿用 */
export const DEFAULT_ROAM_SPEED = 4;

/** 拥有者推导三维内容用到的状态 */
export interface SceneModelsState {
  /** 勾选的模型，按勾选的先后 */
  readonly loaded: readonly string[];
  /** 白膜当前的效果；没记的用第一种 */
  readonly effects: ReadonlyMap<string, string>;
  /** 白膜显示过的效果：留在场景里，换回来不用重新下载 */
  readonly shownEffects: ReadonlyMap<string, readonly string[]>;
  /** 按瓦片集 ID 的重试次数 */
  readonly attempts: ReadonlyMap<string, number>;
  /** 正在进行的漫游：漫游地下的模型时在地下空间 */
  readonly roam: RoamChoice | null;
  /** 按模型 ID 建好的导航网格 */
  readonly navigations: ReadonlyMap<string, Navigation>;
  /** 第三人称的人物模型的绝对地址 */
  readonly avatar: string;
}

/** 瓦片集的 ID：白膜每种效果一个，其他模型一个 */
export function tilesetIdOf(model: SceneModel, effectId: string): string {
  return model.kind === 'white' ? `${model.id}/${effectId}` : model.id;
}

/** 当前效果：白膜记下的或第一种，其他模型只有一种 */
export function currentEffect(model: SceneModel, effects: ReadonlyMap<string, string>): string {
  return effects.get(model.id) ?? model.defaultEffect;
}

/** 模型当前显示的瓦片集 */
export function currentTilesetId(model: SceneModel, effects: ReadonlyMap<string, string>): string {
  return tilesetIdOf(model, currentEffect(model, effects));
}

/**
 * 推导会话的三维内容（ADR 0081 第 2、5、6 节）：勾选的模型各一个瓦片集，白膜显示过的效果都留着、只显示当前的；
 * 地下、室内的用头灯光照。漫游地下的模型时在地下空间（ADR 0097 第 5 节）：地表固定半透明，
 * 不显示地面上的模型（白膜、倾斜摄影会挡住地下空间，ADR 0084）
 */
export function deriveSceneContent(models: readonly SceneModel[], state: SceneModelsState): SceneContent {
  const byId = new Map(models.map(model => [model.id, model]));
  const roaming = state.roam && state.loaded.includes(state.roam.modelId) ? byId.get(state.roam.modelId) : undefined;
  const undergroundModel = roaming?.underground ? roaming : undefined;
  const tilesets: TilesetLayer[] = [];
  for (const id of state.loaded) {
    const model = byId.get(id);
    if (!model) {
      continue;
    }
    const current = currentEffect(model, state.effects);
    const kept = state.shownEffects.get(id) ?? [];
    const lighting = model.underground || model.kind === 'indoor' ? 'headlight' : 'sun';
    for (const effect of model.effects) {
      if (effect.id !== current && !kept.includes(effect.id)) {
        continue;
      }
      const tilesetId = tilesetIdOf(model, effect.id);
      const hidden = !model.underground && undergroundModel !== undefined;
      tilesets.push({
        id: tilesetId,
        url: effect.url,
        show: effect.id === current && !hidden,
        lighting,
        attempt: state.attempts.get(tilesetId) ?? 0,
        ...(model.kind === 'white' ? { group: model.id } : {})
      });
    }
  }
  const underground = undergroundModel
    ? { tilesetId: currentTilesetId(undergroundModel, state.effects), surfaceOpacity: SURFACE_OPACITY }
    : null;
  const roam = roamOf(byId, state);
  return roam ? { tilesets, underground, roam } : { tilesets, underground };
}

// 漫游的模型还勾选着、路线还在时才交给会话；步行要等导航网格建好
function roamOf(
  byId: ReadonlyMap<string, SceneModel>,
  { roam, loaded, navigations, avatar }: SceneModelsState
): SceneRoam | null {
  const model = roam && loaded.includes(roam.modelId) ? byId.get(roam.modelId) : undefined;
  if (!roam || !model) {
    return null;
  }
  if (roam.kind === 'walk') {
    const navigation = navigations.get(model.id);
    const { id, speed, respawn, unstuck, paused, teleport, view } = roam;
    const spawn = model.spawn ?? null;
    return navigation
      ? { kind: 'walk', id, navigation, spawn, speed, respawn, unstuck, paused, teleport, view, avatar }
      : null;
  }
  const route = model.routes.find(item => item.id === roam.routeId);
  if (!route) {
    return null;
  }
  const { id, playing, speed, run } = roam;
  return { kind: 'route', id, path: route.path, playing, speed, run };
}

/** 面板显示的状态 */
export type ModelLoadState = 'loading' | 'ready' | 'failed';

export function loadStateOf(status: TilesetStatus | undefined): ModelLoadState {
  return status?.state ?? 'loading';
}
