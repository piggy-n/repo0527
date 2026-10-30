import { computed, type ComputedRef } from 'vue';
import { type FlowFrame, flowFrame } from '../flow/frame';
import { type FlowPlan, flowPlan } from '../flow/plan';
import type { SimulationRun } from './useSimulationRun';

/** 推演流程图：这一轮的树，以及这一刻每个节点的样子 */
export interface RunFlow {
  /** 还没开始推演时为 null */
  readonly plan: ComputedRef<FlowPlan | null>;
  readonly frame: ComputedRef<FlowFrame | null>;
}

/** 流程图跟着推演走：树随条件和参数变，节点状态每帧按进度算（flow/frame.ts） */
export function useRunFlow(run: SimulationRun): RunFlow {
  const state = run.state;
  const conditions = computed(() => state.value.conditions);
  const params = computed(() => state.value.params);
  const plan = computed(() => {
    const calculator = run.calculator.value;
    return calculator && conditions.value ? flowPlan({ calculator, conditions: conditions.value, params: params.value }) : null;
  });
  // 上一轮出现过的节点：重算时它们在轮到之前显示为待更新
  const previous = computed(() => {
    const calculator = run.calculator.value;
    const { previousConditions, adjustment } = state.value;
    if (!calculator || !previousConditions || !adjustment) {
      return null;
    }
    return new Set(flowPlan({ calculator, conditions: previousConditions, params: adjustment.from }).nodes.map(node => node.key));
  });
  const frame = computed(() => (plan.value ? flowFrame(plan.value, state.value, run.progress, previous.value) : null));
  return { plan, frame };
}
