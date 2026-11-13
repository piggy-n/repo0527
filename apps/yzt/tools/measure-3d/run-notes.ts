import type { RunResult } from './results.ts';

// 一遍的说明：模型的状态、上下文丢失、代理出错，这些决定画面和帧时间能不能信，写进"失败、超时和无效"

/** 模型的名字：模型的 ID 是索引的地址，取它所在的目录名 */
export const modelName = (id: string): string => id.split('/').slice(-2, -1)[0] ?? id;

/** 模型状态、上下文丢失、代理出错写成这一遍的说明；都正常时为空 */
export function runNotes({ models, context, proxy }: Pick<RunResult, 'models' | 'context' | 'proxy'>): string[] {
  const notes: string[] = [];
  for (const [id, { state, error }] of Object.entries(models ?? {})) {
    const name = modelName(id);
    if (state === 'loading') {
      notes.push(`模型 ${name} 一直在加载（整理索引或根节点的请求没有回来）`);
    } else if (state === 'failed') {
      notes.push(`模型 ${name} 加载失败：${error ?? '原因不明'}`);
    }
  }
  if (context && context.lost > 0) {
    notes.push(`WebGL 上下文丢了 ${context.lost} 次（恢复 ${context.restored} 次）`);
  }
  if (proxy && proxy.timeouts + proxy.failures > 0) {
    notes.push(`经代理的请求超时 ${proxy.timeouts} 次、失败 ${proxy.failures} 次`);
  }
  return notes;
}
