import { useRafFn } from '@vueuse/core';
import { onScopeDispose, type Ref, ref, shallowRef, watch } from 'vue';
import type { Composition } from '../compose/composition';
import type { Clock } from '../engine/clock';
import {
  type ApplyOutcome,
  type ApplyPlan,
  type CheckpointDecision,
  type EngineState,
  idleEngineState,
  SimulationEngine
} from '../engine/engine';
import type { StepId } from '../engine/steps';
import type { Calculator } from '../model/calculator';
import type { SimulationParams } from '../model/params';
import { inProgress } from '../run/run-view';

/** 推演的拥有者：引擎的状态快照、按帧刷新的进度，以及开始、停止、确认、干预、暂停 */
export interface SimulationRun {
  readonly state: Readonly<Ref<EngineState>>;
  /** 开始推演时用的计算器；还没开始过时为 null */
  readonly calculator: Readonly<Ref<Calculator | null>>;
  /** 步骤的进度 0～1；在渲染和计算属性里读取时每帧刷新 */
  readonly progress: (step: StepId) => number;
  readonly start: (composition: Composition, calculator: Calculator) => void;
  readonly stop: () => void;
  readonly resolveCheckpoint: (decision: CheckpointDecision) => void;
  readonly planApply: (next: SimulationParams, options?: { readonly baseIndex?: number }) => ApplyPlan;
  readonly apply: (next: SimulationParams, options?: { readonly baseIndex?: number }) => ApplyOutcome;
  /** 暂停，返回解除函数；页面停用、打开人工干预各拿一个 */
  readonly pause: () => () => void;
}

/** 推演的拥有者；clock 只供测试注入 */
export function useSimulationRun(clock?: Clock): SimulationRun {
  // 引擎跟着计算器创建：开始推演时才有计算器
  let engine: SimulationEngine | null = null;
  const state = shallowRef<EngineState>(idleEngineState());
  const calculator = shallowRef<Calculator | null>(null);
  const frame = ref(0);

  const engineFor = (next: Calculator): SimulationEngine => {
    if (engine && calculator.value === next) {
      return engine;
    }
    engine?.[Symbol.dispose]();
    const created = new SimulationEngine({ calculator: next, clock });
    created.on('change', snapshot => {
      state.value = snapshot;
    });
    engine = created;
    calculator.value = next;
    return created;
  };

  const requireEngine = (): SimulationEngine => {
    if (!engine) {
      throw new Error('推演还没有开始');
    }
    return engine;
  };

  // 推演进行、没有暂停时每帧刷新进度
  const ticker = useRafFn(() => frame.value++, { immediate: false });
  watch(
    () => inProgress(state.value.status) && !state.value.paused,
    active => (active ? ticker.resume() : ticker.pause()),
    { immediate: true }
  );

  onScopeDispose(() => {
    engine?.[Symbol.dispose]();
    engine = null;
  });

  return {
    state,
    calculator,
    progress: step => {
      // 读帧号建立依赖，进度本身来自引擎的时钟
      const tick = frame.value;
      return engine && tick >= 0 ? engine.progress(step) : 0;
    },
    start: (composition, next) => engineFor(next).start(composition.conditions, composition.params),
    stop: () => requireEngine().stop(),
    resolveCheckpoint: decision => requireEngine().resolveCheckpoint(decision),
    planApply: (next, options) => requireEngine().planApply(next, options),
    apply: (next, options) => requireEngine().apply(next, options),
    // 还没开始过时没有要暂停的
    pause: () => engine?.pause() ?? (() => undefined)
  };
}
