import type { SceneContent, SceneRoam, TilesetLayer, TilesetStatus } from '@yzt/map-core';
import type { SceneModel } from './catalog';

/** 钻地观察：哪个模型，地表不透明度 0～0.6（ADR 0078 第 5 节、ADR 0081 第 6 节） */
export interface UndergroundChoice {
  readonly modelId: string;
  readonly opacity: number;
}

export const MAX_SURFACE_OPACITY = 0.6;
export const DEFAULT_SURFACE_OPACITY = 0.25;

/** 路线漫游（ADR 0083）：哪个模型的哪条路线；id 每次开始换一个，run 是第几遍 */
export interface RoamChoice {
  readonly modelId: string;
  readonly routeId: string;
  readonly id: string;
  readonly playing: boolean;
  readonly rate: number;
  readonly run: number;
}

/** 路线漫游的倍速 */
export const ROUTE_RATES: readonly number[] = [0.5, 1, 2];

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
  readonly underground: UndergroundChoice | null;
  readonly roam: RoamChoice | null;
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
 * 地下、室内的用头灯光照；钻地期间不显示地面上的模型（白膜、倾斜摄影会挡住地下空间，ADR 0084）
 */
export function deriveSceneContent(models: readonly SceneModel[], state: SceneModelsState): SceneContent {
  const byId = new Map(models.map(model => [model.id, model]));
  const choice = state.underground;
  const undergroundModel = choice && state.loaded.includes(choice.modelId) ? byId.get(choice.modelId) : undefined;
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
  const underground =
    choice && undergroundModel
      ? { tilesetId: currentTilesetId(undergroundModel, state.effects), surfaceOpacity: choice.opacity }
      : null;
  const roam = roamOf(byId, state);
  return roam ? { tilesets, underground, roam } : { tilesets, underground };
}

// 漫游的模型还勾选着、路线还在时才交给会话
function roamOf(byId: ReadonlyMap<string, SceneModel>, { roam, loaded }: SceneModelsState): SceneRoam | null {
  if (!roam || !loaded.includes(roam.modelId)) {
    return null;
  }
  const route = byId.get(roam.modelId)?.routes.find(item => item.id === roam.routeId);
  if (!route) {
    return null;
  }
  const { id, playing, rate, run } = roam;
  return { kind: 'route', id, path: route.path, playing, rate, run };
}

/** 面板显示的状态 */
export type ModelLoadState = 'loading' | 'ready' | 'failed';

export function loadStateOf(status: TilesetStatus | undefined): ModelLoadState {
  return status?.state ?? 'loading';
}
