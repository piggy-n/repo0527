import { ElMessage } from 'element-plus';
import type { SubmitResult } from '../composables/useDataQuery';
import type { QueryOutcome } from '../composables/useQueryResult';

// 提示的文案沿用旧页面；同样的提示合并显示
const options = (message: string) => ({ message, grouping: true });

/** 点"查询"或画完范围后的提示：不能查询的原因、画完还没选图层、自然语言没有识别 */
export function notifySubmit(result: SubmitResult): void {
  switch (result.kind) {
    case 'invalid':
      ElMessage.warning(options(result.reason));
      break;
    case 'drawn':
      ElMessage.success(options('绘制完成，请选择图层后点击查询'));
      break;
    case 'unrecognized':
      ElMessage.warning(options('暂未识别该查询条件，请换一种描述或使用示例语句'));
      break;
    case 'submitted':
    case 'canceled':
      break;
  }
}

/** 查询有了第一个结果时的提示：空间查询报画了几个，自然语言查询报成功；失败的由结果面板显示 */
export function notifyOutcome(outcome: QueryOutcome): void {
  if (outcome.status !== 'success') {
    return;
  }
  const { request } = outcome;
  if (request.kind !== 'attribute') {
    if (outcome.total > 0) {
      ElMessage.success(options(`空间查询成功，已绘制 ${outcome.total} 个结果`));
    } else {
      ElMessage.warning(options('查询成功，但没有可绘制的空间结果'));
    }
  } else if (request.origin === 'natural') {
    ElMessage.success(options('查询成功'));
  }
}
