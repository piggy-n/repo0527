// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import type { Calculator } from '../model/calculator';
import { useSimulationModel } from './useSimulationModel';

// 只确认传递的是同一个对象，不调用它的方法
const calculator = {} as Calculator;

// 由用例决定什么时候完成或失败的加载
function deferred() {
  const handlers: { resolve?: (value: Calculator) => void; reject?: (error: unknown) => void } = {};
  const promise = new Promise<Calculator>((resolve, reject) => {
    Object.assign(handlers, { resolve, reject });
  });
  return {
    promise,
    resolve: (value: Calculator) => handlers.resolve?.(value),
    reject: (error: unknown) => handlers.reject?.(error)
  };
}

// 第 index 次加载用哪一个；多调用了就失败
const next = (attempts: readonly ReturnType<typeof deferred>[], index: number) =>
  attempts[index]?.promise ?? Promise.reject(new Error('多调用了'));

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('useSimulationModel', () => {
  it('加载中 → 完成；失败后重试', async () => {
    const attempts = [deferred(), deferred()];
    let call = 0;
    const scope = effectScope();
    const result = scope.run(() => useSimulationModel(() => next(attempts, call++)));
    if (!result) {
      throw new Error('没有返回值');
    }
    expect(result.model.value).toEqual({ status: 'loading' });

    const error = new Error('县界下载失败');
    attempts[0]?.reject(error);
    await settle();
    expect(result.model.value).toEqual({ status: 'failed', error });

    result.retry();
    expect(result.model.value).toEqual({ status: 'loading' });
    attempts[1]?.resolve(calculator);
    await settle();
    expect(result.model.value).toEqual({ status: 'ready', calculator });
    scope.stop();
  });

  it('重试作废上一次；作用域销毁后晚到的结果不写入', async () => {
    const attempts = [deferred(), deferred()];
    let call = 0;
    const scope = effectScope();
    const result = scope.run(() => useSimulationModel(() => next(attempts, call++)));
    if (!result) {
      throw new Error('没有返回值');
    }
    result.retry();
    attempts[0]?.reject(new Error('旧的失败'));
    await settle();
    expect(result.model.value).toEqual({ status: 'loading' });

    scope.stop();
    attempts[1]?.resolve(calculator);
    await settle();
    expect(result.model.value).toEqual({ status: 'loading' });
  });
});
