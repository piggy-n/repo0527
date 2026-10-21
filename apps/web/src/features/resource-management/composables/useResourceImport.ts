import { computed, type MaybeRefOrGetter, onScopeDispose, readonly, ref, toValue, watch } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { ApiError } from '@/shared/http/errors';
import type { ResourceDetail } from '../api';
import { useResourceImportMutation } from '../queries';

/** 只校验已知的文件格式与空文件；大小、表头及图层匹配交给后端，待契约确认 */
export function validateResourceExcel(file: Pick<File, 'name' | 'size'>): string {
  if (!/\.(xlsx|xls)$/i.test(file.name)) { return '请选择 .xlsx 或 .xls 文件'; }
  return file.size > 0 ? '' : '文件为空，请重新选择';
}

/** 导入是服务端写操作，不自动重试或随卸载取消；界面只显示当前会话的结果 */
export function useResourceImport(
  detail: MaybeRefOrGetter<ResourceDetail | undefined>,
  available: MaybeRefOrGetter<boolean>
) {
  const session = useSessionStore();
  const mutation = useResourceImportMutation();
  const stage = ref<'idle' | 'sending' | 'processing' | 'success' | 'error'>('idle');
  const percent = ref<number | null>(null);
  const message = ref('');
  const pending = computed(() => stage.value === 'sending' || stage.value === 'processing');
  let active: { token: string } | null = null;
  let disposed = false;

  watch([() => session.token, () => toValue(detail)?.id], () => {
    active = null;
    stage.value = 'idle';
    percent.value = null;
    message.value = '';
  }, { flush: 'sync' });
  onScopeDispose(() => { disposed = true; active = null; });

  async function upload(file: File): Promise<boolean> {
    const current = toValue(detail);
    const token = session.token;
    if (disposed || pending.value || !toValue(available) || !current || !token ||
      !session.isActive() || session.user?.role !== Role.admin) { return false; }
    message.value = validateResourceExcel(file);
    if (message.value) { stage.value = 'error'; return false; }
    const operation = { token };
    active = operation;
    const isCurrent = () => !disposed && active === operation && session.token === token;
    stage.value = 'sending';
    percent.value = null;
    try {
      await mutation.mutateAsync({ input: { file, year: current.year }, token, onProgress: value => {
        if (!isCurrent()) { return; }
        percent.value = value.percent;
        if (value.percent === 100) { stage.value = 'processing'; }
      } });
      if (!isCurrent()) { return false; }
      stage.value = 'success';
      message.value = '导入成功';
      return true;
    } catch (cause) {
      if (!isCurrent()) { return false; }
      stage.value = 'error';
      const uncertain = cause instanceof ApiError &&
        ['network', 'timeout', 'canceled', 'invalid-response'].includes(cause.kind);
      message.value = uncertain ? '导入结果未确认，请核对属性后重试' :
        cause instanceof ApiError ? cause.message : '导入失败，请重新选择文件重试';
      return false;
    }
  }

  return { stage: readonly(stage), percent: readonly(percent), message: readonly(message), pending, upload };
}
