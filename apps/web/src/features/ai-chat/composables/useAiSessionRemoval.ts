import { computed, onScopeDispose, reactive } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import { ApiError } from '@/shared/http/errors';
import { useDeleteAiSessionsMutation } from '../queries';

// 删除全部在进行中的记录用的键，不会和对话 ID 重复
const ALL = Symbol('all');

/** 删除历史对话的流程：按对话防重复、记录删除中的状态；确认框和提示由界面提供，这里不渲染、不提示 */
export function useAiSessionRemoval() {
  const mutation = useDeleteAiSessionsMutation();
  const sessionGuard = useSessionGuard();
  const confirming = reactive(new Set<string | typeof ALL>());
  const removing = reactive(new Set<string | typeof ALL>());
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
  });

  async function run(target: string | typeof ALL, confirm: () => Promise<boolean>): Promise<boolean> {
    if (disposed || confirming.has(target) || removing.has(target) || removing.has(ALL)) {
      return false;
    }
    const token = sessionGuard.capture();
    confirming.add(target);
    const confirmed = await confirm();
    confirming.delete(target);
    // 确认期间页面已销毁，或会话已结束、已更换：不再删除
    if (!confirmed || disposed || !sessionGuard.isCurrent(token)) {
      return false;
    }

    removing.add(target);
    try {
      await mutation.mutateAsync({ sessionId: target === ALL ? null : target, token });
      return !disposed && sessionGuard.isCurrent(token);
    } catch (error) {
      // 失败原因已由全局提示显示
      if (error instanceof ApiError) {
        return false;
      }
      throw error;
    } finally {
      removing.delete(target);
    }
  }

  return {
    /** 删除一个历史对话，返回是否删除成功；confirm 返回 false 表示取消 */
    remove: (sessionId: string, confirm: () => Promise<boolean>) => run(sessionId, confirm),
    /** 删除全部历史对话，返回是否删除成功 */
    removeAll: (confirm: () => Promise<boolean>) => run(ALL, confirm),
    /** 这个对话正在删除（含删除全部） */
    isRemoving: (sessionId: string) => removing.has(sessionId) || removing.has(ALL),
    clearing: computed(() => removing.has(ALL))
  };
}

export type AiSessionRemoval = ReturnType<typeof useAiSessionRemoval>;
