import type { RunResult, ZoomResult } from './results.ts';

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

/** 定位后放大一级（--zoom-in）有一步等到超时也没稳定：这一步的读数和截图不是稳定后的，不能拿来比 */
export const zoomUnsettled = (zoom: ZoomResult | undefined): boolean =>
  zoom?.zoomed?.settle.stable === false || zoom?.nudged?.settle.stable === false;

/** 定位后放大一级哪一步没做完、没稳定写成说明；都正常或没跑 --zoom-in 时为空 */
export function zoomNotes(zoom: ZoomResult | undefined): string[] {
  if (!zoom) {
    return [];
  }
  const { zoomed, nudged } = zoom;
  if (!zoomed) {
    return ['放大一级那一步没做完（页面崩溃、超时或截图出错），没有放大后的读数'];
  }
  if (!zoomed.settle.stable) {
    return ['放大一级以后没等到稳定，没有移开再移回'];
  }
  if (nudged && !nudged.settle.stable) {
    return ['移开再移回以后没等到稳定，不判断放大后锁粗了没有'];
  }
  return [];
}
