import type { EngineState } from '../engine/engine';
import { BASE_DURATIONS, STEP_GROUPS, type StepId, STEPS } from '../engine/steps';
import { plainText } from '../run/narrative';
import type { FlowLine, FlowPlan } from './plan';

/** 打字每个字的基础时长（毫秒） */
export const TYPE_MS = 26;
/** 每一步开始先"思考"这么久，再打第一句：时间线上轮换两句提示 */
export const THINK_MS = 1100;
// 标点后多停一会儿（毫秒）
const PAUSE_MS: Readonly<Record<string, number>> = { '，': 110, '、': 80, '；': 140, '：': 120, '。': 220 };
// 两句之间、转到下一个节点前多想一下、一步打完后停留
const LINE_GAP_MS = 320;
const NODE_GAP_MS = 260;
const TAIL_MS = 500;

/** 一句在所属步骤里开始打和打完的时刻（毫秒，从这一步开始算），以及每个字打完的时刻（从这一句开始算） */
export interface LineTiming {
  readonly start: number;
  readonly end: number;
  readonly offsets: readonly number[];
}

// 每个字打完的时刻：基础时长按字的位置有 0.7～1.3 倍的快慢，标点后停顿；同样的句子总是同样的节奏。
// 按 UTF-16 的单位数，和 RichText 截取、length 计数一致
function charOffsets(text: string, seed: number): number[] {
  const offsets: number[] = [];
  let time = 0;
  for (let index = 0; index < text.length; index++) {
    const jitter = 0.7 + (((seed * 31 + index * 17) % 11) / 10) * 0.6;
    time += TYPE_MS * jitter + (PAUSE_MS[text.charAt(index)] ?? 0);
    offsets.push(Math.round(time));
  }
  return offsets;
}

/** 每句的时刻：每步先思考，同一步的句子一句接一句，换节点时多停一下 */
export function lineTimings(plan: FlowPlan): readonly LineTiming[] {
  const cursor = new Map<StepId, number>();
  const previous = new Map<StepId, FlowLine>();
  return plan.lines.map((line, index) => {
    const before = previous.get(line.step);
    const gap = before === undefined ? THINK_MS : LINE_GAP_MS + (before.node !== line.node ? NODE_GAP_MS : 0);
    const start = (cursor.get(line.step) ?? 0) + gap;
    const offsets = charOffsets(plainText(line.text), index);
    const end = start + (offsets.at(-1) ?? 0);
    cursor.set(line.step, end);
    previous.set(line.step, line);
    return { start, end, offsets };
  });
}

/** 各步的时长：打完这一步的话再停一会儿，不短于基础时长 */
export function flowDurations(plan: FlowPlan): Record<StepId, number> {
  const timings = lineTimings(plan);
  const typed = new Map<StepId, number>();
  plan.lines.forEach((line, index) => typed.set(line.step, timings[index]?.end ?? 0));
  return Object.fromEntries(
    STEPS.map(({ id }) => [id, Math.max(BASE_DURATIONS[id], (typed.get(id) ?? 0) + TAIL_MS)])
  ) as Record<StepId, number>;
}

/** 一句打出了几个字：elapsed 是这一步开始后经过的毫秒 */
export function typedChars(timing: LineTiming, elapsed: number): number {
  const passed = elapsed - timing.start;
  const next = timing.offsets.findIndex(offset => offset > passed);
  return next === -1 ? timing.offsets.length : next;
}

/** 节点：还没长出、进行中、完成、参数改了等重算 */
export type NodeStatus = 'hidden' | 'running' | 'done' | 'stale';

export interface NodeFrame {
  readonly status: NodeStatus;
  /** 进行中时这个节点的进度 0～1：自己的几句打到哪里，整步只有它一个节点时是步骤的进度 */
  readonly progress: number;
}

/** 流程图在这一刻的样子：每个节点的状态，以及正在执行的一列（没有时为 null） */
export interface FlowFrame {
  readonly nodes: ReadonlyMap<string, NodeFrame>;
  readonly column: number | null;
}

const HIDDEN: NodeFrame = { status: 'hidden', progress: 0 };
const DONE: NodeFrame = { status: 'done', progress: 1 };
const STALE: NodeFrame = { status: 'stale', progress: 0 };

const COLUMN_OF_STEP = new Map(
  STEPS.map(step => [step.id, STEP_GROUPS.findIndex(group => group.steps.includes(step.id))])
);

/**
 * 流程图这一刻的样子，全部由引擎的状态和进度算出：节点在它的第一句开始打时长出来，自己的话打完就完成，
 * 一步里只有它一个节点时整步都在进行；重算时，上一轮出现过的节点（previous 里有）在轮到它之前显示为待更新
 */
export function flowFrame(
  plan: FlowPlan,
  state: EngineState,
  progress: (step: StepId) => number,
  previous: ReadonlySet<string> | null
): FlowFrame {
  const timings = lineTimings(plan);
  const spans = new Map<string, { start: number; end: number }>();
  plan.lines.forEach((line, index) => {
    const timing = timings[index];
    if (line.node === null || !timing) {
      return;
    }
    const span = spans.get(line.node);
    spans.set(line.node, span ? { start: Math.min(span.start, timing.start), end: Math.max(span.end, timing.end) } : timing);
  });
  const perStep = new Map<StepId, number>();
  for (const node of plan.nodes) {
    perStep.set(node.step, (perStep.get(node.step) ?? 0) + 1);
  }

  const nodes = new Map<string, NodeFrame>();
  for (const node of plan.nodes) {
    const step = state.steps[node.step];
    const seenBefore = previous === null || previous.has(node.key);
    const waitingAgain = step.redo && seenBefore ? STALE : HIDDEN;
    let frame: NodeFrame;
    switch (step.status) {
      case 'waiting':
        frame = HIDDEN;
        break;
      case 'stale':
        frame = waitingAgain;
        break;
      case 'done':
      case 'reused':
        frame = DONE;
        break;
      case 'running': {
        const ratio = progress(node.step);
        const elapsed = ratio * state.durations[node.step];
        const span = spans.get(node.key) ?? { start: 0, end: state.durations[node.step] };
        if (elapsed < span.start) {
          frame = waitingAgain;
        } else if ((perStep.get(node.step) ?? 0) <= 1) {
          frame = { status: 'running', progress: ratio };
        } else if (elapsed >= span.end) {
          frame = DONE;
        } else {
          frame = { status: 'running', progress: (elapsed - span.start) / Math.max(1, span.end - span.start) };
        }
        break;
      }
    }
    nodes.set(node.key, frame);
  }

  const running = STEPS.filter(({ id }) => state.steps[id].status === 'running').map(({ id }) => COLUMN_OF_STEP.get(id) ?? 0);
  const column = state.status === 'planning' ? 0 : running.length > 0 ? Math.max(...running) : null;
  return { nodes, column };
}
