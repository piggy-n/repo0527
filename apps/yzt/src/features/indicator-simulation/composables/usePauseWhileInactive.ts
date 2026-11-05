import { onScopeDispose, type Ref, watch } from 'vue';
import type { SimulationRun } from './useSimulationRun';

/** 页面停用（被缓存、切到别的页面）期间推演暂停，回来后从停下的地方继续（ADR 0105 第 9 条） */
export function usePauseWhileInactive(run: Pick<SimulationRun, 'pause'>, active: Readonly<Ref<boolean>>): void {
  let resume: (() => void) | null = null;
  const release = () => {
    resume?.();
    resume = null;
  };
  // 同步执行：停用的同时停住时钟，不让等待中的步骤在切页的这一刻继续推进；值不变时不触发，不会重复暂停
  watch(
    active,
    value => {
      if (value) {
        release();
      } else {
        resume = run.pause();
      }
    },
    { flush: 'sync', immediate: true }
  );
  onScopeDispose(release);
}
