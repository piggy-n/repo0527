import { computed, type MaybeRefOrGetter, onScopeDispose, readonly, ref, toValue, watch } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import { useSessionStore } from '@/shared/auth/session-store';
import { ApiError } from '@/shared/http/errors';
import type { ResourceDetail } from '../api';
import { useResourceImportMutation } from '../queries';

/** 只校验扩展名和空文件；大小、表头和图层匹配交给后端，等拿到契约再定 */
export function validateResourceExcel(file: Pick<File, 'name' | 'size'>): string {
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    return '请选择 .xlsx 或 .xls 文件';
  }
  return file.size > 0 ? '' : '文件为空，请重新选择';
}

/** sending：发送中；processing：已发完，等服务端处理 */
export type ImportStage = 'idle' | 'sending' | 'processing' | 'success' | 'error';

// 这几种失败不知道服务端有没有执行（请求可能已经到达），不能直接说失败
const UNCERTAIN_FAILURES: ReadonlySet<ApiError['kind']> = new Set([
  'network',
  'timeout',
  'canceled',
  'invalid-response'
]);

function failureMessage(cause: unknown): string {
  if (!(cause instanceof ApiError)) {
    return '导入失败，请重新选择文件重试';
  }
  return UNCERTAIN_FAILURES.has(cause.kind) ? '导入结果未确认，请核对属性后重试' : cause.message;
}

/**
 * 属性规范 Excel 的导入（服务端写操作）：不自动重试，也不随页面销毁取消；界面只显示当前会话、当前资源的结果。
 * available 为 false（编辑中、保存中、详情加载失败）时不导入
 */
export function useResourceImport(
  detail: MaybeRefOrGetter<ResourceDetail | undefined>,
  available: MaybeRefOrGetter<boolean>
) {
  const mutation = useResourceImportMutation();
  const session = useSessionStore();
  const sessionGuard = useSessionGuard();
  const stage = ref<ImportStage>('idle');
  const percent = ref<number | null>(null);
  const message = ref('');
  const pending = computed(() => stage.value === 'sending' || stage.value === 'processing');
  // 当前这次导入；换会话、换资源后旧导入的进度和结果不再写入
  let active: object | null = null;
  let disposed = false;

  watch(
    [() => session.token, () => toValue(detail)?.id],
    () => {
      active = null;
      stage.value = 'idle';
      percent.value = null;
      message.value = '';
    },
    { flush: 'sync' }
  );
  onScopeDispose(() => {
    disposed = true;
    active = null;
  });

  /** 返回是否导入成功；选中的文件不合格时直接进入失败，不发请求 */
  async function upload(file: File): Promise<boolean> {
    const current = toValue(detail);
    if (disposed || pending.value || !toValue(available) || !current) {
      return false;
    }
    message.value = validateResourceExcel(file);
    if (message.value) {
      stage.value = 'error';
      return false;
    }
    const token = sessionGuard.capture();
    const operation = {};
    active = operation;
    const isCurrent = () => !disposed && active === operation && sessionGuard.isCurrent(token);
    stage.value = 'sending';
    percent.value = null;
    try {
      await mutation.mutateAsync({
        input: { file, year: current.year },
        token,
        onProgress: value => {
          if (!isCurrent()) {
            return;
          }
          percent.value = value.percent;
          if (value.percent === 100) {
            stage.value = 'processing';
          }
        }
      });
      if (!isCurrent()) {
        return false;
      }
      stage.value = 'success';
      message.value = '导入成功';
      return true;
    } catch (cause) {
      if (!isCurrent()) {
        return false;
      }
      stage.value = 'error';
      message.value = failureMessage(cause);
      return false;
    }
  }

  return { stage: readonly(stage), percent: readonly(percent), message: readonly(message), pending, upload };
}
