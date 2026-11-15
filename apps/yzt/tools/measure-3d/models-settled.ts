import type { ModelState } from './bench-api.ts';

// 测量页判稳的模型门槛（page/bench.ts）：这个模块不依赖页面，Node 里能测

/**
 * 地址上的每份模型都准备完了（就绪或失败）：还在整理索引的瓦片集不在渲染器里，只看渲染器会在它进来前就判稳。
 * 失败的不挡，不然每遍都等到超时，失败的原因由 run-notes.ts 写进说明；不要求每份都有可见的瓦片，视野外的可能没有
 */
export function modelsSettled(models: Readonly<Record<string, ModelState>>, expected: readonly string[]): boolean {
  return expected.every(id => {
    const state = models[id]?.state;
    return state === 'ready' || state === 'failed';
  });
}
