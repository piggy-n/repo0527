import { LatestController } from '@yzt/utils';
import { onScopeDispose, ref, shallowRef, watch } from 'vue';
import { useSessionStore } from '@/shared/auth/session-store';
import type { TransferProgress } from '@/shared/file-transfer';
import { ApiError } from '@/shared/http/errors';
import { readBlobText } from '@/shared/http/transfer';
import { filePreviewType, type FileTransferTarget } from '../file-types';
import { useFileContentRequest } from '../queries';

export type FilePreviewContent = { signal: AbortSignal } & (
  | { kind: 'docx'; blob: Blob }
  | { kind: 'text'; text: string }
  | { kind: 'pdf' | 'image'; url: string }
);

/** 预览的取流、目标和资源生命周期；渲染由组件承担 */
export function useFilePreview() {
  const read = useFileContentRequest();
  const session = useSessionStore();
  const operation = new LatestController();
  const file = shallowRef<FileTransferTarget | null>(null);
  const content = shallowRef<FilePreviewContent | null>(null);
  const visible = ref(false);
  const phase = ref<'reading' | 'rendering' | 'ready' | 'error'>('reading');
  const progress = shallowRef<TransferProgress | null>(null);
  const failure = ref('');
  const zoom = ref(100);
  let disposed = false;

  const releaseContent = () => {
    const previous = content.value;
    content.value = null;
    if (previous?.kind === 'pdf' || previous?.kind === 'image') {
      URL.revokeObjectURL(previous.url);
    }
  };
  const close = () => {
    operation.abort();
    releaseContent();
    visible.value = false;
    file.value = null;
    progress.value = null;
    failure.value = '';
    zoom.value = 100;
  };
  const current = (signal: AbortSignal) => {
    if (disposed || signal.aborted) {
      return false;
    }
    if (!session.isActive()) {
      close();
      return false;
    }
    return true;
  };
  watch(() => session.session, close, { flush: 'sync' });
  onScopeDispose(() => { disposed = true; close(); operation[Symbol.dispose](); });

  async function open(target: FileTransferTarget): Promise<void> {
    if (disposed) {
      return;
    }
    const signal = operation.next();
    releaseContent();
    file.value = { ...target };
    visible.value = true;
    phase.value = 'reading';
    failure.value = '';
    progress.value = null;
    zoom.value = 100;
    if (!current(signal)) {
      return;
    }
    try {
      const type = filePreviewType(target.type);
      if (!type) {
        throw new Error('不支持预览的类型');
      }
      const result = await read(target, signal, next => { if (current(signal)) { progress.value = next; } });
      if (!current(signal)) {
        return;
      }
      phase.value = 'rendering';
      if (type.kind === 'text') {
        const text = await readBlobText(result.blob, signal);
        if (!current(signal)) {
          return;
        }
        content.value = { kind: 'text', text, signal };
        phase.value = 'ready';
      } else if (result.blob.size === 0) {
        throw new ApiError({ kind: 'invalid-response', message: '文件内容为空，无法预览' });
      } else if (type.kind === 'docx') {
        content.value = { kind: 'docx', blob: result.blob, signal };
      } else {
        // 阅读容器只解释白名单格式，不能把错误的 HTML 类型交给 iframe 执行
        const blob = result.blob.type === type.mime ? result.blob : new Blob([result.blob], { type: type.mime });
        content.value = { kind: type.kind, url: URL.createObjectURL(blob), signal };
      }
    } catch (error) {
      if (!current(signal)) {
        return;
      }
      if (error instanceof ApiError && error.kind === 'canceled') {
        close();
        return;
      }
      releaseContent();
      phase.value = 'error';
      failure.value = error instanceof ApiError ? error.message : '暂时无法预览此文件，可重试或下载后查看';
    }
  }

  const rendered = (target: FilePreviewContent) => {
    if (content.value === target && current(target.signal)) {
      phase.value = 'ready';
    }
  };
  const renderFailed = (target: FilePreviewContent) => {
    if (content.value === target && current(target.signal)) {
      releaseContent();
      phase.value = 'error';
      failure.value = '暂时无法显示此文件，可重试或下载后查看';
    }
  };
  const retry = () => file.value ? open(file.value) : Promise.resolve();
  return { file, content, visible, phase, progress, failure, zoom, open, close, retry, rendered, renderFailed };
}
