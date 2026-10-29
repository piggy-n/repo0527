import type { ParamKey } from '../model/params';

/** 推演的 9 个步骤；数据准备的人口、设施、用地并行 */
export type StepId = 'parse' | 'pop' | 'poi' | 'land' | 'qc' | 'spatial' | 'compute' | 'evaluate' | 'report';

/** 左侧步骤列表的一行：数据准备一行带三个子项，其余一步一行 */
export type StepGroupId = 'parse' | 'prep' | 'qc' | 'spatial' | 'compute' | 'evaluate' | 'report';

export interface StepDefinition {
  readonly id: StepId;
  readonly name: string;
  readonly group: StepGroupId;
  /** 同一层的步骤并行，上一层全部完成才开始下一层 */
  readonly level: number;
  readonly deps: readonly StepId[];
  /** 演示时长（毫秒），界面的动效按它编排 */
  readonly duration: number;
}

export const STEPS: readonly StepDefinition[] = [
  { id: 'parse', name: '条件解析', group: 'parse', level: 0, deps: [], duration: 1800 },
  { id: 'pop', name: '人口数据', group: 'prep', level: 1, deps: ['parse'], duration: 2600 },
  { id: 'poi', name: '设施数据', group: 'prep', level: 1, deps: ['parse'], duration: 3000 },
  { id: 'land', name: '用地数据', group: 'prep', level: 1, deps: ['parse'], duration: 2200 },
  { id: 'qc', name: '数据核查', group: 'qc', level: 2, deps: ['pop', 'poi', 'land'], duration: 2400 },
  { id: 'spatial', name: '空间分析', group: 'spatial', level: 3, deps: ['qc'], duration: 5200 },
  { id: 'compute', name: '指标计算', group: 'compute', level: 4, deps: ['spatial'], duration: 3400 },
  { id: 'evaluate', name: '评价分级', group: 'evaluate', level: 5, deps: ['compute'], duration: 2400 },
  { id: 'report', name: '结论生成', group: 'report', level: 6, deps: ['evaluate'], duration: 2600 }
];

export interface StepGroup {
  readonly id: StepGroupId;
  readonly name: string;
  readonly steps: readonly StepId[];
}

export const STEP_GROUPS: readonly StepGroup[] = [
  { id: 'parse', name: '条件解析', steps: ['parse'] },
  { id: 'prep', name: '数据准备', steps: ['pop', 'poi', 'land'] },
  { id: 'qc', name: '数据核查', steps: ['qc'] },
  { id: 'spatial', name: '空间分析', steps: ['spatial'] },
  { id: 'compute', name: '指标计算', steps: ['compute'] },
  { id: 'evaluate', name: '评价分级', steps: ['evaluate'] },
  { id: 'report', name: '结论生成', steps: ['report'] }
];

/** 各步的基础时长（毫秒）：引擎没有按内容给时长时用它 */
export const BASE_DURATIONS: Readonly<Record<StepId, number>> = Object.fromEntries(
  STEPS.map(step => [step.id, step.duration])
) as Record<StepId, number>;

/** 开始推演后先"规划步骤"多久（毫秒） */
export const PLANNING_DURATION = 1300;

/** 干预后先标出待更新的步骤，过多久开始重算（毫秒） */
export const RERUN_DELAY = 800;

/** 参数项属于哪一步：改了参数，从这一步起重算 */
export const PARAM_STEP: Readonly<Record<ParamKey, StepId>> = {
  popChange: 'pop',
  rule: 'spatial',
  recognition: 'spatial',
  targets: 'evaluate'
};

const BY_ID = new Map(STEPS.map(step => [step.id, step]));

export function stepDefinition(id: StepId): StepDefinition {
  const step = BY_ID.get(id);
  if (!step) {
    throw new Error(`没有步骤 ${id}`);
  }
  return step;
}

/** 一个步骤和它的全部下游 */
export function downstream(id: StepId): Set<StepId> {
  const result = new Set<StepId>([id]);
  // STEPS 按层排好，依赖总在前面，顺着扫一遍就够
  for (const step of STEPS) {
    if (step.deps.some(dep => result.has(dep))) {
      result.add(step.id);
    }
  }
  return result;
}

/** 改了这些参数项，从哪一步起重算：所属步骤里最靠前的；没有改动时为 null */
export function restartStep(keys: readonly ParamKey[]): StepId | null {
  const steps = new Set(keys.map(key => PARAM_STEP[key]));
  return STEPS.find(step => steps.has(step.id))?.id ?? null;
}
