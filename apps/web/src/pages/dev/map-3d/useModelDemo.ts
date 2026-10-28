import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import { LONG_NAME_MODEL, type ModelEntry, SAMPLE_MODELS } from './model-samples';

// 原型的演示拥有者：加载、定位、钻地和两种漫游都只改这里的状态，示意画面和面板按状态显示；不加载真实模型

export type ManifestState = 'loading' | 'failed' | 'ready';

export type LoadStatus = 'loading' | 'ready' | 'failed';

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
  /** 地表不透明度，0～0.6 */
  readonly opacity: number;
}

export type DemoScenario = 'normal' | 'long' | 'empty' | 'failed';

/** 步行速度档位（米/秒），沿用旧项目的档位 */
export const WALK_SPEEDS = [0.5, 1, 1.6, 2.5, 4, 6, 8] as const;
export const DEFAULT_WALK_SPEED = 4;
export const ROUTE_RATES = [0.5, 1, 2] as const;

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
  const focus = ref<string | null>(null);
  const underground = shallowRef<UndergroundState | null>(null);
  const roam = shallowRef<RoamState>({ kind: 'idle' });
  const walkSpeed = ref<number>(DEFAULT_WALK_SPEED);
  const routeRate = ref<number>(1);
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

  function leaveUnderground() {
    underground.value = null;
  }

  function unload(id: string) {
    if (roam.value.kind !== 'idle' && roam.value.modelId === id) {
      exitRoam();
    }
    if (underground.value?.modelId === id) {
      leaveUnderground();
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

  // 地下模型定位时进入钻地观察，地表半透明
  function locate(id: string) {
    focus.value = id;
    if (model(id).underground && underground.value?.modelId !== id) {
      underground.value = { modelId: id, opacity: 0.3 };
    } else if (!model(id).underground) {
      leaveUnderground();
    }
  }

  function setSurfaceOpacity(opacity: number) {
    if (underground.value) {
      underground.value = { ...underground.value, opacity };
    }
  }

  function startWalk(id: string) {
    exitRoam();
    locate(id);
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
  }

  function changeWalkSpeed(step: 1 | -1) {
    const index = WALK_SPEEDS.findIndex(speed => speed === walkSpeed.value);
    walkSpeed.value = WALK_SPEEDS[Math.min(WALK_SPEEDS.length - 1, Math.max(0, index + step))];
  }

  function resetSpawn() {
    say('已回到起始点');
  }

  function unstuck() {
    say('已挪到附近最近的开阔地面');
  }

  function startRoute(id: string, routeId: string) {
    exitRoam();
    focus.value = id;
    leaveUnderground();
    roam.value = { kind: 'route', modelId: id, routeId, phase: 'ready', progress: 0 };
  }

  const routeOf = (state: RoamState) => {
    if (state.kind !== 'route') {
      return undefined;
    }
    return model(state.modelId).routes.find(route => route.id === state.routeId);
  };

  const tick = (last: number) => (now: number) => {
    const current = roam.value;
    const route = routeOf(current);
    if (current.kind !== 'route' || current.phase !== 'playing' || !route) {
      frame = undefined;
      return;
    }
    const step = (((now - last) / 1000) * routeRate.value) / route.duration;
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
    leaveUnderground();
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
    walkSpeed,
    routeRate,
    message,
    failNext,
    model,
    routeOf,
    effectOf,
    load,
    unload,
    retry,
    locate,
    leaveUnderground,
    setSurfaceOpacity,
    startWalk,
    changeWalkSpeed,
    resetSpawn,
    unstuck,
    startRoute,
    play,
    pause,
    exitRoam,
    setEffect,
    setScenario,
    retryManifest
  };
}

export type ModelDemo = ReturnType<typeof useModelDemo>;
