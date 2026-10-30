import { type Ref, shallowRef, watch } from 'vue';
import type { EngineState } from '../engine/engine';
import { STEP_GROUPS, type StepGroupId } from '../engine/steps';
import { flowPlan } from '../flow/plan';
import type { Rich } from '../run/narrative';
import type { SimulationRun } from './useSimulationRun';

/** 被作废的一步：当时的文字和摘要（重算前已完成），或者打到一半被打断 */
export interface FrozenStep {
  readonly state: 'outdated' | 'stopped';
  readonly lines: readonly Rich[];
  readonly summary: string | null;
}

/** AI 推理时间线的一条：用户说的话、AI 的回复、推演的一步 */
export type LogEntry =
  | { readonly kind: 'user'; readonly id: number; readonly text: string }
  | { readonly kind: 'ai'; readonly id: number; readonly text: string; readonly at: number }
  | {
      readonly kind: 'step';
      readonly id: number;
      readonly group: StepGroupId;
      /** 干预或换条件之后重算的一步 */
      readonly rerun: boolean;
      /** 还在跟着推演走时为 null */
      readonly frozen: FrozenStep | null;
    };

/** AI 推理的时间线：思维链、打字和对话按发生的先后排在一起 */
export interface ReasoningLog {
  readonly entries: Readonly<Ref<readonly LogEntry[]>>;
  /** 开始新的推演：清空，有指令时先记下这句话 */
  begin(instruction: string | null): void;
  user(text: string): void;
  /** AI 的回复：从现在起逐字打出 */
  ai(text: string): void;
}

const groupOf = (id: StepGroupId) => STEP_GROUPS.find(group => group.id === id) ?? STEP_GROUPS[0];
const started = (state: EngineState, group: StepGroupId) =>
  (groupOf(group)?.steps ?? []).some(step => state.steps[step].status === 'running' || state.steps[step].status === 'done');
const redo = (state: EngineState, group: StepGroupId) => (groupOf(group)?.steps ?? []).some(step => state.steps[step].redo);
const running = (state: EngineState, group: StepGroupId) =>
  (groupOf(group)?.steps ?? []).some(step => state.steps[step].status === 'running');

/**
 * 时间线跟着引擎的快照走（同步侦听，不漏掉转换）：一步开始时加一条；干预或换条件重算时，
 * 要重算的步骤把旧的一条冻结成"已调整"（打到一半的是"已中断"），重算开始时另加一条；对话由调用方加
 */
export function useReasoningLog(run: SimulationRun, now: () => number = () => performance.now()): ReasoningLog {
  const entries = shallowRef<readonly LogEntry[]>([]);
  let nextId = 1;
  const push = (entry: LogEntry) => {
    entries.value = [...entries.value, entry];
  };

  // 冻结要重算的步骤：已完成的留下当时的文字和摘要，进行中的标为已中断
  const freeze = (before: EngineState, after: EngineState) => {
    const calculator = run.calculator.value;
    const old =
      calculator && before.conditions ? flowPlan({ calculator, conditions: before.conditions, params: before.params }) : null;
    entries.value = entries.value.map(entry => {
      if (entry.kind !== 'step' || entry.frozen !== null || !redo(after, entry.group)) {
        return entry;
      }
      const group = groupOf(entry.group);
      const lines = old?.lines.filter(line => group?.steps.includes(line.step)).map(line => line.text) ?? [];
      const stopped = running(before, entry.group);
      return {
        ...entry,
        frozen: { state: stopped ? 'stopped' : 'outdated', lines: stopped ? [] : lines, summary: stopped ? null : (old?.summaries[entry.group] ?? null) }
      };
    });
  };

  watch(
    run.state,
    (state, before) => {
      if (before && state.adjustment !== null && state.adjustment !== before.adjustment) {
        freeze(before, state);
      }
      const live = new Set(entries.value.flatMap(entry => (entry.kind === 'step' && entry.frozen === null ? [entry.group] : [])));
      for (const group of STEP_GROUPS) {
        if (!live.has(group.id) && started(state, group.id)) {
          push({ kind: 'step', id: nextId++, group: group.id, rerun: redo(state, group.id), frozen: null });
        }
      }
    },
    { flush: 'sync' }
  );

  return {
    entries,
    begin: instruction => {
      entries.value = instruction ? [{ kind: 'user', id: nextId++, text: instruction }] : [];
    },
    user: text => push({ kind: 'user', id: nextId++, text }),
    ai: text => push({ kind: 'ai', id: nextId++, text, at: now() })
  };
}
