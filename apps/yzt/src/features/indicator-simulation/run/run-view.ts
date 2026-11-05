import type { ApplyPlan, EngineState } from '../engine/engine';
import { STEP_GROUPS, stepDefinition } from '../engine/steps';

/** 推演在进行（规划、执行） */
export const inProgress = (status: EngineState['status']): boolean => status === 'planning' || status === 'running';

/** 干预会怎样生效的说明 */
export function planText(plan: ApplyPlan): string {
  if (plan.outcome === 'unchanged' || plan.restart === null) {
    return plan.outcome === 'rerun' ? '参数与上一轮相同，直接生成新版本' : '参数未变化';
  }
  const name = stepDefinition(plan.restart).name;
  switch (plan.outcome) {
    case 'saved':
      return `「${name}」尚未执行，保存后执行到这一步时生效`;
    case 'rerun':
      break;
  }
  // 按左侧的行数：数据准备的三路算一个环节
  const reused = STEP_GROUPS.findIndex(group => plan.restart !== null && group.steps.includes(plan.restart));
  return `将从「${name}」重算，前面 ${reused} 个环节复用已有结果`;
}
