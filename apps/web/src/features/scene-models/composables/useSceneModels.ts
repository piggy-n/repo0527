import type { RoamStatus, SceneContent, TilesetStatus } from '@yzt/map-core';
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
  type RoamChoice,
  ROUTE_RATES,
  type SceneModelsState,
  tilesetIdOf,
  type UndergroundChoice
} from '../scene-content';

/** 拥有者用到的上下文 */
export type SceneModelsContext = Pick<
  MapContext,
  'sceneStatus' | 'roamStatus' | 'runCameraOperation' | 'beginCameraOperation'
>;

/** 路线漫游的阶段：停在起点、播放中、暂停、到了终点 */
export type RoutePhase = 'ready' | 'playing' | 'paused' | 'finished';

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
  /** 正在漫游的路线（ADR 0083） */
  readonly roam: Readonly<ShallowRef<RoamChoice | null>>;
  /** 这一次、这一遍漫游的进度；视图还没报告时为 null */
  readonly roamStatus: ComputedRef<RoamStatus | null>;
  readonly routePhase: ComputedRef<RoutePhase | null>;
  /** 开始一条路线：一次新的相机操作，停在起点；之后有别的定位就退出。只有加载完成的模型能开始 */
  readonly startRoute: (id: string, routeId: string) => void;
  /** 开始、继续；到了终点从头再走一遍 */
  readonly playRoute: () => void;
  readonly pauseRoute: () => void;
  readonly setRouteRate: (rate: number) => void;
  /** 结束漫游；地下的模型保留钻地 */
  readonly exitRoam: () => void;
  /** 绑定给会话的推导函数（ADR 0081 第 2 节） */
  readonly deriveContent: () => SceneContent;
}

/**
 * 三维模型的拥有者（ADR 0081、0083）：持有勾选、白膜效果、重试、定位、钻地和路线漫游，推导会话的三维内容；
 * 状态来自上下文的 sceneStatus、roamStatus。参数不合法时抛错
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
  const roam = shallowRef<RoamChoice | null>(null);
  // 漫游开始时的相机操作：中止（有了别的定位）就退出漫游
  let roamSignal: AbortSignal | null = null;
  let roamCount = 0;

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
    if (roam.value?.modelId === id) {
      exitRoam();
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

  const roamStatus = computed(() => {
    const current = roam.value;
    const status = map.roamStatus.value;
    return current && status?.id === current.id && status.run === current.run ? status : null;
  });

  const routePhase = computed((): RoutePhase | null => {
    const current = roam.value;
    if (!current) {
      return null;
    }
    const status = roamStatus.value;
    if (status?.finished) {
      return 'finished';
    }
    if (current.playing) {
      return 'playing';
    }
    return (status?.distance ?? 0) > 0 ? 'paused' : 'ready';
  });

  const releaseOperation = () => {
    roamSignal?.removeEventListener('abort', exitRoam);
    roamSignal = null;
  };

  function exitRoam(): void {
    releaseOperation();
    roam.value = null;
  }

  const startRoute = (id: string, routeId: string) => {
    assertLoaded(id);
    const model = modelOf(id);
    if (!model.routes.some(route => route.id === routeId)) {
      throw new Error(`模型 ${id} 没有路线 ${routeId}`);
    }
    if (loadStateOf(statusOf(model)) !== 'ready') {
      throw new Error(`模型 ${id} 还不能漫游`);
    }
    releaseOperation();
    const { signal } = map.beginCameraOperation();
    const choice: RoamChoice = {
      modelId: id,
      routeId,
      id: `${id}/${routeId}/${++roamCount}`,
      playing: false,
      rate: roam.value?.rate ?? 1,
      run: 0
    };
    // 开始、退出时先撤掉上一次的监听，所以中止的一定是当前这次漫游
    signal.addEventListener('abort', exitRoam, { once: true });
    roamSignal = signal;
    roam.value = choice;
    focus.value = id;
    // 地下的模型漫游时按钻地处理：相机能到地表以下（ADR 0083 第 4 节）
    if (model.underground && underground.value?.modelId !== id) {
      underground.value = { modelId: id, opacity: underground.value?.opacity ?? DEFAULT_SURFACE_OPACITY };
    }
  };

  const updateRoam = (change: Partial<Pick<RoamChoice, 'playing' | 'rate' | 'run'>>) => {
    const current = roam.value;
    if (!current) {
      throw new Error('没有在漫游');
    }
    roam.value = { ...current, ...change };
  };

  const playRoute = () => {
    const current = roam.value;
    if (routePhase.value === 'finished' && current) {
      updateRoam({ playing: true, run: current.run + 1 });
    } else {
      updateRoam({ playing: true });
    }
  };

  const setRouteRate = (rate: number) => {
    if (!ROUTE_RATES.includes(rate)) {
      throw new Error(`漫游的倍速只能是 ${ROUTE_RATES.join('、')}：${rate}`);
    }
    updateRoam({ rate });
  };

  const state = (): SceneModelsState => ({
    loaded: loaded.value,
    effects: effects.value,
    shownEffects: shownEffects.value,
    attempts: attempts.value,
    underground: underground.value,
    roam: roam.value
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
    roam: shallowReadonly(roam),
    roamStatus,
    routePhase,
    startRoute,
    playRoute,
    pauseRoute: () => updateRoam({ playing: false }),
    setRouteRate,
    exitRoam,
    deriveContent: () => deriveSceneContent(models.value, state())
  };
}
