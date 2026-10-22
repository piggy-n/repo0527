import { onScopeDispose, watch } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import { useSessionStore } from '@/shared/auth/session-store';
import { ApiError } from '@/shared/http/errors';
import { useUploadFilesMutation } from '../queries';
import { useFileUploadForm } from './useFileUploadForm';

/** 上传一批文件：提交时复制草稿，发送中关窗不影响这一批；不渲染、不提示 */
export function useFileUpload() {
  const form = useFileUploadForm();
  const mutation = useUploadFilesMutation();
  const session = useSessionStore();
  const sessionGuard = useSessionGuard();
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
  });
  // 换会话时上一个会话的草稿和结果都不保留；已发出的这一批由服务端完成，结果不再显示
  watch(
    () => session.token,
    () => {
      form.phase.value = 'draft';
      form.close();
    },
    { flush: 'sync' }
  );

  /** 返回是否上传成功；页面已销毁或换了会话时不再更新界面，返回 false */
  async function submit(): Promise<boolean> {
    if (disposed || !form.validate()) {
      return false;
    }
    const token = sessionGuard.capture();
    const current = () => !disposed && sessionGuard.isCurrent(token);
    const input = { ...form.fields, files: [...form.files.value] };
    form.phase.value = 'sending';
    form.progress.value = null;
    form.failure.value = '';
    try {
      await mutation.mutateAsync({
        input,
        token,
        onProgress: progress => {
          // 换会话后表单已重置，这一批后面的进度不能把它改回发送中
          if (current()) {
            form.progress.value = progress;
            form.phase.value = progress.percent === 100 ? 'processing' : 'sending';
          }
        }
      });
      if (!current()) {
        return false;
      }
      form.phase.value = 'success';
      return true;
    } catch (error) {
      if (!current()) {
        return false;
      }
      form.failure.value = error instanceof ApiError ? error.message : '上传未完成，请稍后重试';
      form.phase.value = 'error';
      return false;
    }
  }

  return { ...form, submit };
}
