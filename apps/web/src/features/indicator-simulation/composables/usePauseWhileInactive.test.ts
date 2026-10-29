// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { effectScope, ref } from 'vue';
import { required } from '@/shared/testing/required';
import { sampleComposition } from '../compose/composition';
import { ManualClock } from '../engine/test-clock';
import { createCalculator } from '../model/calculator';
import { loadTestAtlas } from '../model/test-atlas';
import { usePauseWhileInactive } from './usePauseWhileInactive';
import { useSimulationRun } from './useSimulationRun';

// 规划 1300 后开始条件解析；条件解析的时长按推理的话多少给，不短于 1800
const PLANNING = 1300;

async function setup() {
  const calculator = createCalculator(await loadTestAtlas());
  const clock = new ManualClock();
  const active = ref(true);
  const scope = effectScope();
  const run = required(
    scope.run(() => {
      const owned = useSimulationRun(clock);
      usePauseWhileInactive(owned, active);
      return owned;
    }),
    '推演的拥有者'
  );
  return { run, calculator, clock, active, [Symbol.dispose]: () => scope.stop() };
}

describe('usePauseWhileInactive', () => {
  it('停用期间推演暂停、进度不走，回来后从停下的地方继续', async () => {
    using ctx = await setup();
    const { run, calculator, clock, active } = ctx;
    run.start(sampleComposition(), calculator);
    await clock.advance(PLANNING + 900);
    const before = run.progress('parse');

    active.value = false;
    expect(run.state.value.paused).toBe(true);
    await clock.advance(5000);
    expect(run.progress('parse')).toBe(before);
    expect(run.state.value.steps.parse.status).toBe('running');

    active.value = true;
    expect(run.state.value.paused).toBe(false);
    await clock.advance(450);
    expect(run.progress('parse')).toBeCloseTo(before + 450 / run.state.value.durations.parse, 6);
  });

  it('和人工干预的暂停互不影响：停用又激活后，干预还没关时仍然暂停', async () => {
    using ctx = await setup();
    const { run, calculator, clock, active } = ctx;
    run.start(sampleComposition(), calculator);
    await clock.advance(PLANNING);
    const resumeIntervention = run.pause();

    active.value = false;
    active.value = true;
    expect(run.state.value.paused).toBe(true);
    resumeIntervention();
    expect(run.state.value.paused).toBe(false);
  });

  it('一开始就停用时立即暂停；重复停用只拿一次暂停；停用中作用域销毁时解除', () => {
    const calls = { paused: 0, released: 0 };
    const run = {
      pause: () => {
        calls.paused++;
        return () => calls.released++;
      }
    };
    const active = ref(false);
    const scope = effectScope();
    scope.run(() => usePauseWhileInactive(run, active));
    expect(calls).toEqual({ paused: 1, released: 0 });

    active.value = true;
    active.value = false;
    active.value = false;
    expect(calls).toEqual({ paused: 2, released: 1 });
    scope.stop();
    expect(calls).toEqual({ paused: 2, released: 2 });
  });
});
