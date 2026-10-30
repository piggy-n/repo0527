import { onScopeDispose, type Ref, ref, watch } from 'vue';
import { inProgress } from '../run/run-view';
import type { SimulationRun } from './useSimulationRun';

/** 用户自己的暂停：阶段条的按钮和对话里的"暂停""继续"共用一个，和页面停用、人工干预的暂停互不影响 */
export interface UserPause {
  readonly paused: Readonly<Ref<boolean>>;
  /** 暂停；推演不在进行或已经暂停时返回 false */
  pause(): boolean;
  /** 继续；没有暂停时返回 false */
  resume(): boolean;
}

export function useUserPause(run: SimulationRun): UserPause {
  const paused = ref(false);
  let release: (() => void) | null = null;
  const resume = () => {
    if (!release) {
      return false;
    }
    release();
    release = null;
    paused.value = false;
    return true;
  };
  // 推演结束、停止或重新开始时，这次暂停跟着结束
  watch(
    () => inProgress(run.state.value.status),
    active => {
      if (!active) {
        resume();
      }
    }
  );
  onScopeDispose(resume);
  return {
    paused,
    pause: () => {
      if (release || !inProgress(run.state.value.status)) {
        return false;
      }
      release = run.pause();
      paused.value = true;
      return true;
    },
    resume
  };
}
