import type { SceneContent, TilesetStatus } from '@yzt/map-core';
import type { MapContext } from '@yzt/map-vue';
import {
  computed,
  type ComputedRef,
  type MaybeRefOrGetter,
  type ShallowRef,
  shallowReadonly,
  shallowRef,
  toValue
} from 'vue';
import type { SceneModel } from '../catalog';
import {
  currentEffect,
  currentTilesetId,
  DEFAULT_SURFACE_OPACITY,
  deriveSceneContent,
  loadStateOf,
  MAX_SURFACE_OPACITY,
  type ModelLoadState,
  type SceneModelsState,
  tilesetIdOf,
  type UndergroundChoice
} from '../scene-content';

/** 拥有者用到的上下文 */
export type SceneModelsContext = Pick<MapContext, 'sceneStatus' | 'runCameraOperation'>;

export interface SceneModels {
  /** 目录：清单还没到、失败时为空 */
  readonly models: ComputedRef<readonly SceneModel[]>;
  /** 清单已经到了：区分"还没有目录"和"目录是空的" */
  readonly hasCatalog: ComputedRef<boolean>;
  /** 勾选的模型，按勾选的先后 */
  readonly loaded: Readonly<ShallowRef<readonly string[]>>;
  /** 最近定位的模型 */
  readonly focus: Readonly<ShallowRef<string | null>>;
  readonly underground: Readonly<ShallowRef<UndergroundChoice | null>>;
  /** 模型当前显示的瓦片集的状态；没勾选、还没有报告时是 loading */
  readonly stateOf: (id: string) => ModelLoadState;
  readonly effectOf: (id: string) => string;
  readonly setChecked: (id: string, checked: boolean) => void;
  readonly setEffect: (id: string, effectId: string) => void;
  /** 一次新的相机操作：飞到模型；地下的模型同时进入钻地，地面上的结束钻地（ADR 0081 第 4 节） */
  readonly locate: (id: string) => void;
  /** 失败的瓦片集重新加载 */
  readonly retry: (id: string) => void;
  readonly setSurfaceOpacity: (opacity: number) => void;
  readonly exitUnderground: () => void;
  /** 绑定给会话的推导函数（ADR 0081 第 2 节） */
  readonly deriveContent: () => SceneContent;
}

/**
 * 三维模型的拥有者（ADR 0081）：持有勾选、白膜效果、重试、定位和钻地，推导会话的三维内容；
 * 状态来自上下文的 sceneStatus。参数不合法时抛错
 */
export function useSceneModels(
  map: SceneModelsContext,
  catalog: MaybeRefOrGetter<readonly SceneModel[] | undefined>
): SceneModels {
  const models = computed(() => toValue(catalog) ?? []);
  const hasCatalog = computed(() => toValue(catalog) !== undefined);
  const loaded = shallowRef<readonly string[]>([]);
  const effects = shallowRef<ReadonlyMap<string, string>>(new Map());
  const shownEffects = shallowRef<ReadonlyMap<string, readonly string[]>>(new Map());
  const attempts = shallowRef<ReadonlyMap<string, number>>(new Map());
  const focus = shallowRef<string | null>(null);
  const underground = shallowRef<UndergroundChoice | null>(null);

  const modelOf = (id: string): SceneModel => {
    const model = models.value.find(item => item.id === id);
    if (!model) {
      throw new Error(`目录里没有模型 ${id}`);
    }
    return model;
  };

  const statusOf = (model: SceneModel): TilesetStatus | undefined =>
    map.sceneStatus.value.get(currentTilesetId(model, effects.value));

  const assertLoaded = (id: string) => {
    if (!loaded.value.includes(id)) {
      throw new Error(`模型 ${id} 没有加载`);
    }
  };

  const setChecked = (id: string, checked: boolean) => {
    const model = modelOf(id);
    if (checked === loaded.value.includes(id)) {
      return;
    }
    if (checked) {
      loaded.value = [...loaded.value, id];
      return;
    }
    loaded.value = loaded.value.filter(item => item !== id);
    // 卸载时这个模型的效果、重试次数一起忘掉；在它里面钻地、定位过的一并结束
    shownEffects.value = new Map([...shownEffects.value].filter(([modelId]) => modelId !== id));
    const tilesetIds = new Set(model.effects.map(effect => tilesetIdOf(model, effect.id)));
    attempts.value = new Map([...attempts.value].filter(([tilesetId]) => !tilesetIds.has(tilesetId)));
    if (underground.value?.modelId === id) {
      underground.value = null;
    }
    if (focus.value === id) {
      focus.value = null;
    }
  };

  const setEffect = (id: string, effectId: string) => {
    const model = modelOf(id);
    if (!model.effects.some(effect => effect.id === effectId) || model.kind !== 'white') {
      throw new Error(`模型 ${id} 没有效果 ${effectId}`);
    }
    const previous = currentEffect(model, effects.value);
    if (previous === effectId) {
      return;
    }
    effects.value = new Map([...effects.value, [id, effectId]]);
    // 换走的效果留在场景里，换回来不用重新下载
    const kept = shownEffects.value.get(id) ?? [];
    if (!kept.includes(previous)) {
      shownEffects.value = new Map([...shownEffects.value, [id, [...kept, previous]]]);
    }
  };

  const locate = (id: string) => {
    assertLoaded(id);
    const model = modelOf(id);
    const status = statusOf(model);
    if (status?.state !== 'ready') {
      throw new Error(`模型 ${id} 还不能定位`);
    }
    const { camera } = status;
    map.runCameraOperation(control => control.flyTo(camera));
    focus.value = id;
    underground.value = model.underground
      ? { modelId: id, opacity: underground.value?.opacity ?? DEFAULT_SURFACE_OPACITY }
      : null;
  };

  const retry = (id: string) => {
    assertLoaded(id);
    const tilesetId = currentTilesetId(modelOf(id), effects.value);
    attempts.value = new Map([...attempts.value, [tilesetId, (attempts.value.get(tilesetId) ?? 0) + 1]]);
  };

  const setSurfaceOpacity = (opacity: number) => {
    const current = underground.value;
    if (!current) {
      throw new Error('没有在钻地');
    }
    if (!(opacity >= 0 && opacity <= MAX_SURFACE_OPACITY)) {
      throw new Error(`地表不透明度不在 0～${MAX_SURFACE_OPACITY} 之间：${opacity}`);
    }
    if (opacity !== current.opacity) {
      underground.value = { ...current, opacity };
    }
  };

  const exitUnderground = () => {
    underground.value = null;
  };

  const state = (): SceneModelsState => ({
    loaded: loaded.value,
    effects: effects.value,
    shownEffects: shownEffects.value,
    attempts: attempts.value,
    underground: underground.value
  });

  return {
    models,
    hasCatalog,
    loaded: shallowReadonly(loaded),
    focus: shallowReadonly(focus),
    underground: shallowReadonly(underground),
    stateOf: id => (loaded.value.includes(id) ? loadStateOf(statusOf(modelOf(id))) : 'loading'),
    effectOf: id => currentEffect(modelOf(id), effects.value),
    setChecked,
    setEffect,
    locate,
    retry,
    setSurfaceOpacity,
    exitUnderground,
    deriveContent: () => deriveSceneContent(models.value, state())
  };
}
