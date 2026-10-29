// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import { required } from '@/shared/testing/required';
import { defaultComposition } from '../compose/composition';
import { ManualClock } from '../engine/test-clock';
import { createCalculator } from '../model/calculator';
import { loadTestAtlas } from '../model/test-atlas';
import { useSimulationRun } from './useSimulationRun';

describe('useSimulationRun', () => {
  it('开始前是空闲，暂停什么也不做；开始后状态跟着引擎走；作用域销毁时释放引擎', async () => {
    const calculator = createCalculator(await loadTestAtlas());
    const clock = new ManualClock();
    const scope = effectScope();
    const run = required(scope.run(() => useSimulationRun(clock)), '推演的拥有者');
    expect(run.state.value.status).toBe('idle');
    expect(() => run.pause()()).not.toThrow();
    expect(() => run.stop()).toThrow('推演还没有开始');

    run.start(defaultComposition(), calculator);
    expect(run.state.value.status).toBe('planning');
    expect(run.calculator.value).toBe(calculator);
    await clock.advance(1300 + 900);
    expect(run.state.value.status).toBe('running');
    expect(run.progress('parse')).toBeCloseTo(0.5, 6);

    scope.stop();
    expect(clock.pending).toBe(0);
  });
});
