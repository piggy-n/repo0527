import { onScopeDispose, reactive } from 'vue';
import { useSessionStore } from '@/shared/auth/session-store';
import { ApiError } from '@/shared/http/errors';
import { useDeleteFileMutation } from '../queries';

/** 删除文件的流程：按文件 ID 防重复、记录删除中的状态；确认框和提示由界面提供，这里不渲染、不提示 */
export function useFileRemoval() {
  const mutation = useDeleteFileMutation();
  const session = useSessionStore();
  // 按文件 ID 记录：删除 A 未完成时删除 B，A 的状态不会被覆盖
  const confirming = reactive(new Set<string>());
  const removing = reactive(new Set<string>());
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
  });

  /**
   * 删除一个文件，返回是否删除成功。confirm 由界面提供（例如确认框），返回 false 表示取消；
   * 同一个文件正在确认或删除中时直接返回 false
   */
  async function remove(id: string, confirm: () => Promise<boolean>): Promise<boolean> {
    if (confirming.has(id) || removing.has(id)) {
      return false;
    }
    const token = session.token;
    confirming.add(id);
    const confirmed = await confirm();
    confirming.delete(id);
    // 确认期间页面已销毁，或会话已结束、已更换：不再删除。token 只是过期时照常请求，由 http 按登录过期处理并提示
    if (!confirmed || disposed || session.token !== token) {
      return false;
    }

    removing.add(id);
    try {
      await mutation.mutateAsync(id);
      return true;
    } catch (error) {
      // 失败原因已由全局提示显示（例如"文件不存在"）
      if (error instanceof ApiError) {
        return false;
      }
      throw error;
    } finally {
      removing.delete(id);
    }
  }

  return {
    /** 这个文件的删除请求是否在进行中（不含确认阶段） */
    isRemoving: (id: string) => removing.has(id),
    remove
  };
}
