import {
  DEFAULT_WALK_SPEED,
  type Navigation,
  type NavPoint,
  type RoamStatus,
  type RouteRoamStatus,
  type SceneContent,
  type TilesetStatus,
  type WalkNotice,
  type WalkPlayer,
  type WalkRoamStatus,
  WALK_SPEEDS,
  type WalkView,
  WALK_VIEWS
} from '@yzt/map-core';
import type { MapContext } from '@yzt/map-vue';
import {
  computed,
  type ComputedRef,
  type MaybeRefOrGetter,
  onScopeDispose,
  type ShallowRef,
  shallowReadonly,
  shallowRef,
  toValue
} from 'vue';
import type { SceneModel } from '../catalog';
import { type IndoorMap, indoorMapOf } from '../indoor-map/indoor-map';
import { buildFraction, type LoadNavigation, loadNavigation as defaultLoadNavigation } from '../navigation';
import {
  currentEffect,
  currentTilesetId,
  DEFAULT_SURFACE_OPACITY,
  deriveSceneContent,
  loadStateOf,
  MAX_SURFACE_OPACITY,
  type ModelLoadState,
  type RoamChoice,
  type RouteChoice,
  ROUTE_RATES,
  type SceneModelsState,
  tilesetIdOf,
  type UndergroundChoice,
  walkAvatarUrl,
  type WalkChoice
} from '../scene-content';

/** 拥有者用到的上下文 */
export type SceneModelsContext = Pick<
  MapContext,
  'sceneStatus' | 'roamStatus' | 'runCameraOperation' | 'beginCameraOperation'
>;

/** 路线漫游的阶段：停在起点、播放中、暂停、到了终点 */
export type RoutePhase = 'ready' | 'playing' | 'paused' | 'finished';

/**
 * 步行的阶段（ADR 0086 第 5 节）：分析站内空间（建导航网格，progress 是 0～1）、飞进站内、行走中；
 * 失败分两种：导航网格建不出来（可以重试）、附近找不到能站的地方
 */
export type WalkStage =
  | { readonly kind: 'preparing'; readonly progress: number }
  | { readonly kind: 'entering' }
  | { readonly kind: 'walking' }
  | { readonly kind: 'failed'; readonly reason: 'build' | 'spawn' };

/** 步行中最近的一条提示；count 每来一条加 1，同样的提示再来一次也能看出来 */
export interface WalkNoticeState {
  readonly notice: WalkNotice;
  readonly count: number;
}

export interface SceneModelsOptions {
  /** 建导航网格；默认读索引、下载瓦片、在 Worker 里构建，测试时换掉 */
  readonly loadNavigation?: LoadNavigation;
  /** 第三人称的人物模型的绝对地址；默认随应用部署的 Cesium Man */
  readonly avatarUrl?: string;
}

export interface SceneModels {
  /** 目录：清单还没到、失败时为空 */
  readonly models: ComputedRef<readonly SceneModel[]>;
  /** 清单已经到了：区分"还没有目录"和"目录是空的" */
  readonly hasCatalog: ComputedRef<boolean>;
  /** 勾选的模型，按勾选的先后 */
  readonly loaded: Readonly<ShallowRef<readonly string[]>>;
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
  /** 正在进行的漫游：路线（ADR 0083）或步行（ADR 0086） */
  readonly roam: Readonly<ShallowRef<RoamChoice | null>>;
  /** 这一次（路线是这一遍）漫游的状态；视图还没报告时为 null */
  readonly roamStatus: ComputedRef<RoamStatus | null>;
  /** 路线漫游的阶段；没在路线漫游时为 null */
  readonly routePhase: ComputedRef<RoutePhase | null>;
  /** 开始一条路线：一次新的相机操作，停在起点；之后有别的定位就退出。只有加载完成的模型能开始 */
  readonly startRoute: (id: string, routeId: string) => void;
  /** 开始、继续；到了终点从头再走一遍 */
  readonly playRoute: () => void;
  readonly pauseRoute: () => void;
  readonly setRouteRate: (rate: number) => void;
  /** 步行的阶段；没在步行时为 null */
  readonly walkStage: ComputedRef<WalkStage | null>;
  readonly walkNotice: ComputedRef<WalkNoticeState | null>;
  /**
   * 开始步行：一次新的相机操作，导航网格没建过就先建（建好的按模型留着），建好后交给会话；之后有别的定位就退出。
   * 只有加载完成、清单里有出生点的模型能开始
   */
  readonly startWalk: (id: string) => void;
  /** 导航网格建不出来时重新建 */
  readonly retryWalk: () => void;
  readonly setWalkSpeed: (speed: number) => void;
  /** 换人称（ADR 0090）：在几次步行之间沿用 */
  readonly setWalkView: (view: WalkView) => void;
  readonly respawnWalk: () => void;
  readonly unstuckWalk: () => void;
  /** 步行模型的室内地图（ADR 0087）：导航网格建好以后才有 */
  readonly indoorMap: ComputedRef<IndoorMap | null>;
  /** 视图报告的人的位置和朝向：进到站内以后才有 */
  readonly walkPlayer: ComputedRef<WalkPlayer | null>;
  /** 完整地图打开着：步行暂停 */
  readonly mapOpen: ComputedRef<boolean>;
  readonly openMap: () => void;
  readonly closeMap: () => void;
  /** 在完整地图上双击：闪切到 spot（导航网格的局部系），关掉完整地图 */
  readonly teleportWalk: (spot: NavPoint) => void;
  /** 结束漫游（步行时还在建的导航网格一并中止）；地下的模型保留钻地 */
  readonly exitRoam: () => void;
  /** 绑定给会话的推导函数（ADR 0081 第 2 节） */
  readonly deriveContent: () => SceneContent;
}

// 正在建的导航网格：属于哪一次步行，进度或失败
type WalkBuild =
  | { readonly walkId: string; readonly state: 'building'; readonly progress: number }
  | { readonly walkId: string; readonly state: 'failed'; readonly error: unknown };

/**
 * 三维模型的拥有者（ADR 0081、0083、0086）：持有勾选、白膜效果、重试、定位、钻地和漫游，推导会话的三维内容；
 * 状态来自上下文的 sceneStatus、roamStatus。参数不合法时抛错
 */
export function useSceneModels(
  map: SceneModelsContext,
  catalog: MaybeRefOrGetter<readonly SceneModel[] | undefined>,
  { loadNavigation = defaultLoadNavigation, avatarUrl = walkAvatarUrl() }: SceneModelsOptions = {}
): SceneModels {
  const models = computed(() => toValue(catalog) ?? []);
  const hasCatalog = computed(() => toValue(catalog) !== undefined);
  const loaded = shallowRef<readonly string[]>([]);
  const effects = shallowRef<ReadonlyMap<string, string>>(new Map());
  const shownEffects = shallowRef<ReadonlyMap<string, readonly string[]>>(new Map());
  const attempts = shallowRef<ReadonlyMap<string, number>>(new Map());
  const underground = shallowRef<UndergroundChoice | null>(null);
  const roam = shallowRef<RoamChoice | null>(null);
  const navigations = shallowRef<ReadonlyMap<string, Navigation>>(new Map());
  const walkBuild = shallowRef<WalkBuild | null>(null);
  // 漫游开始时的相机操作：中止（有了别的定位）就退出漫游
  let roamSignal: AbortSignal | null = null;
  let roamCount = 0;
  // 正在建的导航网格：结束步行、换一次漫游、卸载模型时中止
  let building: AbortController | null = null;
  // 步行速度、人称在几次步行之间沿用
  let walkSpeed = DEFAULT_WALK_SPEED;
  let walkView: WalkView = 'first';

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
    // 卸载时这个模型的效果、重试次数、导航网格一起忘掉；在它里面钻地、漫游过的一并结束
    shownEffects.value = new Map([...shownEffects.value].filter(([modelId]) => modelId !== id));
    const tilesetIds = new Set(model.effects.map(effect => tilesetIdOf(model, effect.id)));
    attempts.value = new Map([...attempts.value].filter(([tilesetId]) => !tilesetIds.has(tilesetId)));
    if (navigations.value.has(id)) {
      navigations.value = new Map([...navigations.value].filter(([modelId]) => modelId !== id));
    }
    if (underground.value?.modelId === id) {
      underground.value = null;
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

  // 视图报告的是这一次（路线还要是这一遍）漫游才算
  const roamStatus = computed((): RoamStatus | null => {
    const current = roam.value;
    const status = map.roamStatus.value;
    if (!current || status?.kind !== current.kind || status.id !== current.id) {
      return null;
    }
    return status.kind === 'route' && current.kind === 'route' && status.run !== current.run ? null : status;
  });

  const routeStatus = computed((): RouteRoamStatus | null =>
    roamStatus.value?.kind === 'route' ? roamStatus.value : null
  );

  const walkStatus = computed((): WalkRoamStatus | null =>
    roamStatus.value?.kind === 'walk' ? roamStatus.value : null
  );

  const routePhase = computed((): RoutePhase | null => {
    const current = roam.value;
    if (current?.kind !== 'route') {
      return null;
    }
    const status = routeStatus.value;
    if (status?.finished) {
      return 'finished';
    }
    if (current.playing) {
      return 'playing';
    }
    return (status?.distance ?? 0) > 0 ? 'paused' : 'ready';
  });

  const walkStage = computed((): WalkStage | null => {
    const current = roam.value;
    if (current?.kind !== 'walk') {
      return null;
    }
    const build = walkBuild.value;
    if (build?.walkId === current.id && build.state === 'failed') {
      return { kind: 'failed', reason: 'build' };
    }
    if (!navigations.value.has(current.modelId)) {
      const progress = build?.walkId === current.id && build.state === 'building' ? build.progress : 0;
      return { kind: 'preparing', progress };
    }
    const phase = walkStatus.value?.phase ?? 'entering';
    return phase === 'failed' ? { kind: 'failed', reason: 'spawn' } : { kind: phase };
  });

  const walkNotice = computed((): WalkNoticeState | null => {
    const status = walkStatus.value;
    return status?.notice ? { notice: status.notice, count: status.notices } : null;
  });

  const releaseOperation = () => {
    roamSignal?.removeEventListener('abort', exitRoam);
    roamSignal = null;
  };

  const stopBuilding = () => {
    building?.abort();
    building = null;
    walkBuild.value = null;
  };

  function exitRoam(): void {
    releaseOperation();
    stopBuilding();
    roam.value = null;
  }
  onScopeDispose(stopBuilding);

  // 开始一次漫游：一次新的相机操作，之后有别的定位就退出；地下的模型漫游时按钻地处理，相机能到地表以下
  const beginRoam = (model: SceneModel, choice: RoamChoice) => {
    releaseOperation();
    stopBuilding();
    const { signal } = map.beginCameraOperation();
    // 开始、退出时先撤掉上一次的监听，所以中止的一定是当前这次漫游
    signal.addEventListener('abort', exitRoam, { once: true });
    roamSignal = signal;
    roam.value = choice;
    if (model.underground && underground.value?.modelId !== model.id) {
      underground.value = { modelId: model.id, opacity: underground.value?.opacity ?? DEFAULT_SURFACE_OPACITY };
    }
  };

  const assertRoamable = (model: SceneModel, what: string) => {
    if (loadStateOf(statusOf(model)) !== 'ready') {
      throw new Error(`模型 ${model.id} 还不能${what}`);
    }
  };

  const startRoute = (id: string, routeId: string) => {
    assertLoaded(id);
    const model = modelOf(id);
    if (!model.routes.some(route => route.id === routeId)) {
      throw new Error(`模型 ${id} 没有路线 ${routeId}`);
    }
    assertRoamable(model, '漫游');
    const previous = roam.value;
    beginRoam(model, {
      kind: 'route',
      modelId: id,
      routeId,
      id: `${id}/${routeId}/${++roamCount}`,
      playing: false,
      rate: previous?.kind === 'route' ? previous.rate : 1,
      run: 0
    });
  };

  const updateRoute = (change: Partial<Pick<RouteChoice, 'playing' | 'rate' | 'run'>>) => {
    const current = roam.value;
    if (current?.kind !== 'route') {
      throw new Error('没有在路线漫游');
    }
    roam.value = { ...current, ...change };
  };

  const playRoute = () => {
    const current = roam.value;
    if (routePhase.value === 'finished' && current?.kind === 'route') {
      updateRoute({ playing: true, run: current.run + 1 });
    } else {
      updateRoute({ playing: true });
    }
  };

  const setRouteRate = (rate: number) => {
    if (!ROUTE_RATES.includes(rate)) {
      throw new Error(`漫游的倍速只能是 ${ROUTE_RATES.join('、')}：${rate}`);
    }
    updateRoute({ rate });
  };

  // 白膜各种效果的几何一样，取当前的那一个
  const currentEffectUrl = (model: SceneModel): string => {
    const effectId = currentEffect(model, effects.value);
    const effect = model.effects.find(item => item.id === effectId);
    if (!effect) {
      throw new Error(`模型 ${model.id} 没有效果 ${effectId}`);
    }
    return effect.url;
  };

  // 建好的放进按模型的导航网格里；中止的不写入，失败的显示在操作条上
  const build = async (model: SceneModel, walkId: string) => {
    stopBuilding();
    const controller = new AbortController();
    building = controller;
    const { signal } = controller;
    walkBuild.value = { walkId, state: 'building', progress: 0 };
    try {
      const navigation = await loadNavigation(currentEffectUrl(model), {
        signal,
        onProgress: progress => {
          if (!signal.aborted) {
            walkBuild.value = { walkId, state: 'building', progress: buildFraction(progress) };
          }
        }
      });
      if (signal.aborted) {
        return;
      }
      // 楼层和着色也在分析站内空间时算好，进到站内再算会顿一下
      indoorMapOf(navigation);
      building = null;
      walkBuild.value = null;
      navigations.value = new Map([...navigations.value, [model.id, navigation]]);
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      building = null;
      walkBuild.value = { walkId, state: 'failed', error };
    }
  };

  const startWalk = (id: string) => {
    assertLoaded(id);
    const model = modelOf(id);
    if (!model.spawn) {
      throw new Error(`模型 ${id} 的清单里没有出生点，不能步行`);
    }
    assertRoamable(model, '步行');
    const choice: WalkChoice = {
      kind: 'walk',
      modelId: id,
      id: `${id}/walk/${++roamCount}`,
      speed: walkSpeed,
      respawn: 0,
      unstuck: 0,
      paused: false,
      teleport: null,
      view: walkView
    };
    beginRoam(model, choice);
    if (!navigations.value.has(id)) {
      void build(model, choice.id);
    }
  };

  const currentWalk = (): WalkChoice => {
    const current = roam.value;
    if (current?.kind !== 'walk') {
      throw new Error('没有在步行');
    }
    return current;
  };

  const retryWalk = () => {
    const current = currentWalk();
    if (walkStage.value?.kind !== 'failed' || walkStage.value.reason !== 'build') {
      throw new Error('导航网格没有失败，不用重试');
    }
    void build(modelOf(current.modelId), current.id);
  };

  const setWalkSpeed = (speed: number) => {
    const current = currentWalk();
    if (!WALK_SPEEDS.includes(speed)) {
      throw new Error(`步行速度只能是 ${WALK_SPEEDS.join('、')}：${speed}`);
    }
    walkSpeed = speed;
    if (speed !== current.speed) {
      roam.value = { ...current, speed };
    }
  };

  const setWalkView = (view: WalkView) => {
    const current = currentWalk();
    if (!WALK_VIEWS.includes(view)) {
      throw new Error(`人称只能是 ${WALK_VIEWS.join('、')}：${view}`);
    }
    walkView = view;
    if (view !== current.view) {
      roam.value = { ...current, view };
    }
  };

  const respawnWalk = () => {
    const current = currentWalk();
    roam.value = { ...current, respawn: current.respawn + 1 };
  };

  const unstuckWalk = () => {
    const current = currentWalk();
    roam.value = { ...current, unstuck: current.unstuck + 1 };
  };

  const indoorMap = computed((): IndoorMap | null => {
    const current = roam.value;
    const navigation = current?.kind === 'walk' ? navigations.value.get(current.modelId) : undefined;
    return navigation ? indoorMapOf(navigation) : null;
  });

  const walkPlayer = computed(() => walkStatus.value?.player ?? null);

  const mapOpen = computed(() => roam.value?.kind === 'walk' && roam.value.paused);

  // 完整地图只在进到站内以后打开；打开、关上时暂停、继续步行
  const setMapOpen = (open: boolean) => {
    const current = currentWalk();
    if (open && walkStage.value?.kind !== 'walking') {
      throw new Error('还没有进到站内，不能打开完整地图');
    }
    if (current.paused !== open) {
      roam.value = { ...current, paused: open };
    }
  };

  const teleportWalk = (spot: NavPoint) => {
    const current = currentWalk();
    if (![spot.x, spot.y, spot.floor].every(Number.isFinite)) {
      throw new Error(`瞬移的位置有不是数的坐标：${spot.x}, ${spot.y}, ${spot.floor}`);
    }
    roam.value = { ...current, paused: false, teleport: { count: (current.teleport?.count ?? 0) + 1, spot } };
  };

  const state = (): SceneModelsState => ({
    loaded: loaded.value,
    effects: effects.value,
    shownEffects: shownEffects.value,
    attempts: attempts.value,
    underground: underground.value,
    roam: roam.value,
    navigations: navigations.value,
    avatar: avatarUrl
  });

  return {
    models,
    hasCatalog,
    loaded: shallowReadonly(loaded),
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
    pauseRoute: () => updateRoute({ playing: false }),
    setRouteRate,
    walkStage,
    walkNotice,
    startWalk,
    retryWalk,
    setWalkSpeed,
    setWalkView,
    respawnWalk,
    unstuckWalk,
    indoorMap,
    walkPlayer,
    mapOpen,
    openMap: () => setMapOpen(true),
    closeMap: () => setMapOpen(false),
    teleportWalk,
    exitRoam,
    deriveContent: () => deriveSceneContent(models.value, state())
  };
}
