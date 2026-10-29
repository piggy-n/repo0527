import type { ApplyPlan, EngineState, StepStatus } from '../engine/engine';
import { STEP_GROUPS, stepDefinition, type StepGroup, type StepGroupId, type StepId } from '../engine/steps';

/** 左侧一行的状态：由这一行的步骤汇总 */
export type GroupStatus = StepStatus;

export const STATUS_LABELS: Readonly<Record<GroupStatus, string>> = {
  waiting: '',
  running: '进行中',
  checkpoint: '需确认',
  done: '完成',
  reused: '复用',
  stale: '待更新'
};

const RUNNING_TEXT: Readonly<Record<StepId, string>> = {
  parse: '理解条件、规划步骤…',
  pop: '读取中',
  poi: '载入中',
  land: '载入中',
  qc: '核查数据完整性…',
  spatial: '生成服务圈、叠加分析…',
  compute: '逐区县计算…',
  evaluate: '对照演示目标…',
  report: '撰写结论…'
};

const CHECKPOINT_TEXT: Readonly<Partial<Record<StepId, string>>> = {
  qc: '等待你确认缺失处理',
  spatial: '等待你确认参数'
};

/** 推演在进行（规划、执行、等人确认） */
export const inProgress = (status: EngineState['status']): boolean =>
  status === 'planning' || status === 'running' || status === 'checkpoint';

export function stepGroup(id: StepGroupId): StepGroup {
  const group = STEP_GROUPS.find(item => item.id === id);
  if (!group) {
    throw new Error(`没有步骤分组 ${id}`);
  }
  return group;
}

export const groupOfStep = (step: StepId): StepGroup => {
  const group = STEP_GROUPS.find(item => item.steps.includes(step));
  if (!group) {
    throw new Error(`步骤 ${step} 不在任何分组里`);
  }
  return group;
};

/** 汇总一行的状态：等人确认、进行中、待更新优先；全部复用才是复用 */
export function groupStatus(group: StepGroupId, steps: EngineState['steps']): GroupStatus {
  const statuses = stepGroup(group).steps.map(id => steps[id].status);
  const first = (['checkpoint', 'running', 'stale'] as const).find(status => statuses.includes(status));
  if (first) {
    return first;
  }
  if (statuses.every(status => status === 'reused')) {
    return 'reused';
  }
  if (statuses.every(status => status === 'done' || status === 'reused')) {
    return 'done';
  }
  return statuses.some(status => status !== 'waiting') ? 'running' : 'waiting';
}

/** 已经出现在左侧的行：开始过的 */
export const visibleGroups = (state: EngineState): StepGroupId[] =>
  STEP_GROUPS.filter(group => groupStatus(group.id, state.steps) !== 'waiting').map(group => group.id);

/** 下一行（虚影）：推演进行中、已经有行出现时，第一个还没开始的 */
export function nextGroup(state: EngineState): StepGroupId | null {
  if (!inProgress(state.status) || visibleGroups(state).length === 0) {
    return null;
  }
  return STEP_GROUPS.find(group => groupStatus(group.id, state.steps) === 'waiting')?.id ?? null;
}

/** 当前的一行：正在执行或等人确认的；干预后等待重算时是重算起点所在的一行 */
export function currentGroup(state: EngineState): StepGroupId | null {
  const active = STEP_GROUPS.find(group => {
    const status = groupStatus(group.id, state.steps);
    return status === 'running' || status === 'checkpoint';
  });
  if (active) {
    return active.id;
  }
  if (state.restart !== null && inProgress(state.status)) {
    return groupOfStep(state.restart).id;
  }
  return visibleGroups(state).at(-1) ?? null;
}

/** 完成（含复用）的行数 */
export const doneCount = (state: EngineState): number =>
  STEP_GROUPS.filter(group => {
    const status = groupStatus(group.id, state.steps);
    return status === 'done' || status === 'reused';
  }).length;

/** 一个步骤的说明：进行中写在做什么，完成后写摘要 */
export function stepText(step: StepId, state: EngineState, summary: string | undefined): string {
  switch (state.steps[step].status) {
    case 'waiting':
      return '等待';
    case 'running':
      return state.paused ? '已暂停' : RUNNING_TEXT[step];
    case 'checkpoint':
      return CHECKPOINT_TEXT[step] ?? '等待确认';
    case 'stale':
      return '等待更新';
    case 'done':
    case 'reused':
      break;
  }
  return summary ?? '完成';
}

/** 一行的说明：数据准备汇总三路，其余同步骤的说明 */
export function groupText(group: StepGroupId, state: EngineState, summaries: Partial<Record<StepId, string>>): string {
  const { steps } = stepGroup(group);
  const [only] = steps;
  if (steps.length === 1 && only !== undefined) {
    return stepText(only, state, summaries[only]);
  }
  const status = groupStatus(group, state.steps);
  if (status === 'running') {
    return state.paused ? '已暂停' : `${steps.length} 路数据并行读取…`;
  }
  if (status === 'done' || status === 'reused') {
    return `${steps.length} 路数据已就绪`;
  }
  return status === 'stale' ? '等待更新' : '等待';
}

/** 这一行是干预后重算的起点（显示"已调整"） */
export const isRestartGroup = (group: StepGroupId, state: EngineState): boolean =>
  state.restart !== null && stepGroup(group).steps.includes(state.restart);

/** 干预会怎样生效的说明 */
export function planText(plan: ApplyPlan): string {
  if (plan.outcome === 'unchanged' || plan.restart === null) {
    return plan.outcome === 'rerun' ? '参数与上一轮相同，直接生成新版本' : '参数未变化';
  }
  const name = stepDefinition(plan.restart).name;
  switch (plan.outcome) {
    case 'saved':
      return `「${name}」尚未执行，保存后执行到这一步时生效`;
    case 'resolved':
      return `作为「${name}」的确认，接着推演`;
    case 'rerun':
      break;
  }
  // 按左侧的行数：数据准备的三路算一个环节
  const reused = STEP_GROUPS.findIndex(group => plan.restart !== null && group.steps.includes(plan.restart));
  return `将从「${name}」重算，前面 ${reused} 个环节复用已有结果`;
}
