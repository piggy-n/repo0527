import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import { LONG_NAME_MODEL, type ModelEntry, SAMPLE_MODELS } from './model-samples';

// 原型的演示拥有者：加载、定位和漫游都只改这里的状态，示意画面和面板按状态显示；不加载真实模型。
// 2026-10-28 的漫游原型：没有单独的钻地，漫游地下的模型时才在地下；步行和路线是同一次漫游的两种方式，速度共用

export type ManifestState = 'loading' | 'failed' | 'ready';

export type LoadStatus = 'loading' | 'ready' | 'failed';

export type RoamMode = 'walk' | 'route';

export type WalkPhase = 'preparing' | 'entering' | 'walking';

export type RoutePhase = 'ready' | 'playing' | 'paused' | 'finished';

export type RoamState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'walk'; readonly modelId: string; readonly phase: WalkPhase; readonly progress: number }
  | {
      readonly kind: 'route';
      readonly modelId: string;
      readonly routeId: string;
      readonly phase: RoutePhase;
      readonly progress: number;
    };

export interface UndergroundState {
  readonly modelId: string;
  /** 地表不透明度：漫游地下的模型时固定半透明 */
  readonly opacity: number;
}

export type DemoScenario = 'normal' | 'long' | 'empty' | 'failed';

/** 漫游速度档位（米/秒），步行和路线共用，默认 4 */
export const ROAM_SPEEDS = [0.5, 1, 1.6, 2.5, 4, 6, 8] as const;
export const DEFAULT_ROAM_SPEED = 4;

const UNDERGROUND_OPACITY = 0.25;
const LOAD_DELAY = 1200;
const PREPARE_STEP = 0.06;
const PREPARE_INTERVAL = 100;
const ENTER_DELAY = 800;
const MESSAGE_DELAY = 2400;

export function useModelDemo() {
  const manifest = ref<ManifestState>('ready');
  const models = shallowRef<readonly ModelEntry[]>(SAMPLE_MODELS);
  const loads = shallowRef<ReadonlyMap<string, LoadStatus>>(new Map());
  const effects = shallowRef<ReadonlyMap<string, string>>(new Map());
  // 示意画面的相机对着的模型（定位、漫游）
  const focus = ref<string | null>(null);
  const roam = shallowRef<RoamState>({ kind: 'idle' });
  const speed = ref<number>(DEFAULT_ROAM_SPEED);
  // 每个模型上次走的路线，从步行切回路线时接着用
  const lastRoutes = new Map<string, string>();
  const message = ref('');
  // 演示开关：下一次加载失败
  const failNext = ref(false);

  const timers = new Set<ReturnType<typeof setTimeout>>();
  let prepareTimer: ReturnType<typeof setInterval> | undefined;
  let frame: number | undefined;
  let messageTimer: ReturnType<typeof setTimeout> | undefined;

  const later = (delay: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, delay);
    timers.add(timer);
  };

  const byId = computed(() => new Map(models.value.map(model => [model.id, model])));

  const model = (id: string): ModelEntry => {
    const found = byId.value.get(id);
    if (!found) {
      throw new Error(`没有模型 ${id}`);
    }
    return found;
  };

  const roamingModel = computed(() => {
    const current = roam.value;
    return current.kind === 'idle' ? null : model(current.modelId);
  });

  // 地下空间只在漫游地下的模型时出现；退出漫游就回到地面
  const underground = computed((): UndergroundState | null => {
    const current = roamingModel.value;
    return current?.underground ? { modelId: current.id, opacity: UNDERGROUND_OPACITY } : null;
  });

  const setLoad = (id: string, status: LoadStatus | null) => {
    const next = new Map(loads.value);
    if (status === null) {
      next.delete(id);
    } else {
      next.set(id, status);
    }
    loads.value = next;
  };

  const say = (text: string) => {
    message.value = text;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => {
      message.value = '';
    }, MESSAGE_DELAY);
  };

  const stopPlayback = () => {
    clearInterval(prepareTimer);
    prepareTimer = undefined;
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
      frame = undefined;
    }
  };

  const startLoading = (id: string) => {
    setLoad(id, 'loading');
    const fail = failNext.value;
    failNext.value = false;
    later(LOAD_DELAY, () => {
      // 期间被卸载或重新加载的不再改状态
      if (loads.value.get(id) === 'loading') {
        setLoad(id, fail ? 'failed' : 'ready');
      }
    });
  };

  function load(id: string) {
    if (!loads.value.has(id)) {
      startLoading(id);
    }
  }

  function exitRoam() {
    stopPlayback();
    roam.value = { kind: 'idle' };
  }

  function unload(id: string) {
    if (roamingModel.value?.id === id) {
      exitRoam();
    }
    if (focus.value === id) {
      focus.value = null;
    }
    setLoad(id, null);
  }

  function retry(id: string) {
    if (loads.value.get(id) === 'failed') {
      startLoading(id);
    }
  }

  // 定位只飞过去；地下的模型在地表以下，从地面上看不到（没有单独的钻地）
  function locate(id: string) {
    focus.value = id;
  }

  const startWalk = (id: string) => {
    stopPlayback();
    roam.value = { kind: 'walk', modelId: id, phase: 'preparing', progress: 0 };
    prepareTimer = setInterval(() => {
      const current = roam.value;
      if (current.kind !== 'walk' || current.phase !== 'preparing') {
        return;
      }
      const progress = Math.min(1, current.progress + PREPARE_STEP);
      if (progress < 1) {
        roam.value = { ...current, progress };
        return;
      }
      clearInterval(prepareTimer);
      roam.value = { ...current, phase: 'entering', progress: 1 };
      later(ENTER_DELAY, () => {
        const entering = roam.value;
        if (entering.kind === 'walk' && entering.modelId === id && entering.phase === 'entering') {
          roam.value = { ...entering, phase: 'walking' };
        }
      });
    }, PREPARE_INTERVAL);
  };

  // 选一条路线：停在起点，等用户开始
  function startRoute(id: string, routeId: string) {
    stopPlayback();
    lastRoutes.set(id, routeId);
    roam.value = { kind: 'route', modelId: id, routeId, phase: 'ready', progress: 0 };
  }

  const routeIdFor = (entry: ModelEntry) => lastRoutes.get(entry.id) ?? entry.routes[0]?.id;

  /** 已加载里的"漫游"：能步行的从步行开始，只有路线的停在第一条路线的起点 */
  function startRoam(id: string) {
    const entry = model(id);
    focus.value = id;
    const routeId = routeIdFor(entry);
    if (entry.walkable) {
      startWalk(id);
    } else if (routeId !== undefined) {
      startRoute(id, routeId);
    }
  }

  /** 漫游面板里切换方式：同一个模型，速度不变 */
  function setMode(mode: RoamMode) {
    const current = roamingModel.value;
    if (!current || roam.value.kind === mode) {
      return;
    }
    const routeId = routeIdFor(current);
    if (mode === 'walk') {
      startWalk(current.id);
    } else if (routeId !== undefined) {
      startRoute(current.id, routeId);
    }
  }

  function changeSpeed(step: 1 | -1) {
    const index = ROAM_SPEEDS.findIndex(item => item === speed.value);
    speed.value = ROAM_SPEEDS[Math.min(ROAM_SPEEDS.length - 1, Math.max(0, index + step))];
  }

  function resetSpeed() {
    speed.value = DEFAULT_ROAM_SPEED;
  }

  function resetSpawn() {
    say('已回到起始点');
  }

  function unstuck() {
    say('已挪到附近最近的开阔地面');
  }

  const routeOf = (state: RoamState) => {
    if (state.kind !== 'route') {
      return undefined;
    }
    return model(state.modelId).routes.find(route => route.id === state.routeId);
  };

  // 按速度（米/秒）和路线长度推进
  const tick = (last: number) => (now: number) => {
    const current = roam.value;
    const route = routeOf(current);
    if (current.kind !== 'route' || current.phase !== 'playing' || !route) {
      frame = undefined;
      return;
    }
    const step = (((now - last) / 1000) * speed.value) / route.length;
    const progress = Math.min(1, current.progress + step);
    roam.value = { ...current, progress, phase: progress >= 1 ? 'finished' : 'playing' };
    frame = progress >= 1 ? undefined : requestAnimationFrame(tick(now));
  };

  function play() {
    const current = roam.value;
    if (current.kind !== 'route' || current.phase === 'playing') {
      return;
    }
    const progress = current.phase === 'finished' ? 0 : current.progress;
    roam.value = { ...current, phase: 'playing', progress };
    frame = requestAnimationFrame(tick(performance.now()));
  }

  function pause() {
    const current = roam.value;
    if (current.kind === 'route' && current.phase === 'playing') {
      stopPlayback();
      roam.value = { ...current, phase: 'paused' };
    }
  }

  function setEffect(id: string, effect: string) {
    effects.value = new Map(effects.value).set(id, effect);
  }

  function effectOf(id: string): string | undefined {
    return effects.value.get(id) ?? model(id).effects[0]?.id;
  }

  // 演示场景：清单正常、带长名称、空清单、清单加载失败
  function setScenario(scenario: DemoScenario) {
    exitRoam();
    focus.value = null;
    loads.value = new Map();
    manifest.value = scenario === 'failed' ? 'failed' : 'ready';
    if (scenario === 'empty') {
      models.value = [];
    } else if (scenario === 'long') {
      models.value = [LONG_NAME_MODEL, ...SAMPLE_MODELS];
    } else {
      models.value = SAMPLE_MODELS;
    }
  }

  function retryManifest() {
    manifest.value = 'loading';
    later(LOAD_DELAY, () => {
      manifest.value = 'ready';
      models.value = SAMPLE_MODELS;
    });
  }

  onScopeDispose(() => {
    timers.forEach(timer => clearTimeout(timer));
    clearTimeout(messageTimer);
    stopPlayback();
  });

  return {
    manifest,
    models,
    loads,
    focus,
    underground,
    roam,
    roamingModel,
    speed,
    message,
    failNext,
    model,
    routeOf,
    effectOf,
    load,
    unload,
    retry,
    locate,
    startRoam,
    setMode,
    startRoute,
    changeSpeed,
    resetSpeed,
    resetSpawn,
    unstuck,
    play,
    pause,
    exitRoam,
    setEffect,
    setScenario,
    retryManifest
  };
}

export type ModelDemo = ReturnType<typeof useModelDemo>;
