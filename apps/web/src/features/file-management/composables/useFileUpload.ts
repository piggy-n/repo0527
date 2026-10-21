import { onScopeDispose, watch } from 'vue';
import { useSessionStore } from '@/shared/auth/session-store';
import { ApiError } from '@/shared/http/errors';
import { useUploadFilesMutation } from '../queries';
import { useFileUploadForm } from './useFileUploadForm';

/** 一次上传持有独立文件快照；关闭丢弃草稿，卸载或换会话后不再写回界面 */
export function useFileUpload() {
  const form = useFileUploadForm();
  const mutation = useUploadFilesMutation();
  const session = useSessionStore();
  let disposed = false;
  onScopeDispose(() => { disposed = true; });
  watch(() => session.session, () => {
    form.phase.value = 'draft';
    form.close();
  }, { flush: 'sync' });

  async function submit(): Promise<boolean> {
    if (disposed || !form.validate() || !session.session) {
      return false;
    }
    const sentSession = session.session;
    const current = () => !disposed && session.session === sentSession && session.isActive();
    const input = { ...form.fields, files: [...form.files.value] };
    form.phase.value = 'sending';
    form.progress.value = null;
    form.failure.value = '';
    try {
      await mutation.mutateAsync({
        input,
        session: sentSession,
        onProgress: progress => {
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
