import { LatestController } from '@yzt/utils';
import { onScopeDispose, ref, shallowRef, watch } from 'vue';
import { useSessionStore } from '@/shared/auth/session-store';
import type { TransferProgress } from '@/shared/file-transfer';
import { ApiError } from '@/shared/http/errors';
import { readBlobText } from '@/shared/http/transfer';
import { fetchFileContent } from '../api';
import { filePreviewType, type FilePreviewKind, type FileTransferTarget } from '../file-types';

/** 交给阅读区的内容；signal 属于取得它的那次打开，组件渲染完再用它确认内容没有过期 */
export type FilePreviewContent = { signal: AbortSignal } & (
  | { kind: 'docx'; blob: Blob }
  | { kind: 'text'; text: string }
  | { kind: 'pdf' | 'image'; url: string }
);

/** reading：取流中；rendering：内容已交给阅读区，等组件报告显示完成（rendered）或失败（renderFailed） */
export type FilePreviewPhase = 'reading' | 'rendering' | 'ready' | 'error';

const ZOOM_DEFAULT = 100;

// DOCX 交给组件渲染，PDF、图片转成 object URL；空文件在这里失败，不让阅读区一直停在加载中
function binaryContent(kind: Exclude<FilePreviewKind, 'text'>, mime: string, blob: Blob, signal: AbortSignal) {
  if (blob.size === 0) {
    throw new ApiError({ kind: 'invalid-response', message: '文件内容为空，无法预览' });
  }
  if (kind === 'docx') {
    return { kind, blob, signal };
  }
  // 按白名单的类型交给 iframe 和 img：服务端给错类型（例如 HTML）时也不会被当成网页执行
  const typed = blob.type === mime ? blob : new Blob([blob], { type: mime });
  return { kind, url: URL.createObjectURL(typed), signal };
}

/**
 * 预览的取流、当前目标和内容的生命周期；渲染由组件负责。打开另一个文件是可替换操作（LatestController），
 * 关闭、换会话、页面销毁都中止读取并释放内容
 */
export function useFilePreview() {
  const session = useSessionStore();
  const operation = new LatestController();
  const file = shallowRef<FileTransferTarget | null>(null);
  const content = shallowRef<FilePreviewContent | null>(null);
  const visible = ref(false);
  const phase = ref<FilePreviewPhase>('reading');
  const progress = shallowRef<TransferProgress | null>(null);
  const failure = ref('');
  const zoom = ref(ZOOM_DEFAULT);
  let disposed = false;

  // PDF、图片的 object URL 归预览所有，换内容和关闭时释放
  function releaseContent() {
    const previous = content.value;
    content.value = null;
    if (previous?.kind === 'pdf' || previous?.kind === 'image') {
      URL.revokeObjectURL(previous.url);
    }
  }

  function close() {
    operation.abort();
    releaseContent();
    visible.value = false;
    file.value = null;
    progress.value = null;
    failure.value = '';
    zoom.value = ZOOM_DEFAULT;
  }

  function fail(message: string) {
    releaseContent();
    phase.value = 'error';
    failure.value = message;
  }

  watch(() => session.token, close, { flush: 'sync' });
  onScopeDispose(() => {
    disposed = true;
    close();
    operation[Symbol.dispose]();
  });

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
    zoom.value = ZOOM_DEFAULT;
    const type = filePreviewType(target.type);
    if (!type) {
      fail('不支持预览这种格式，请下载后查看');
      return;
    }
    try {
      const result = await fetchFileContent(target, signal, next => {
        progress.value = next;
      });
      if (signal.aborted) {
        return;
      }
      phase.value = 'rendering';
      if (type.kind !== 'text') {
        content.value = binaryContent(type.kind, type.mime, result.blob, signal);
        return;
      }
      // 文本在这里读出，直接就绪
      const text = await readBlobText(result.blob, signal);
      if (signal.aborted) {
        return;
      }
      content.value = { kind: 'text', text, signal };
      phase.value = 'ready';
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      fail(error instanceof ApiError ? error.message : '暂时无法预览此文件，可重试或下载后查看');
    }
  }

  /** 组件显示完成；旧内容晚到的报告不改变当前状态 */
  function rendered(target: FilePreviewContent) {
    if (content.value === target && !target.signal.aborted) {
      phase.value = 'ready';
    }
  }

  function renderFailed(target: FilePreviewContent) {
    if (content.value === target && !target.signal.aborted) {
      fail('暂时无法显示此文件，可重试或下载后查看');
    }
  }

  const retry = () => (file.value ? open(file.value) : Promise.resolve());

  return { file, content, visible, phase, progress, failure, zoom, open, close, retry, rendered, renderFailed };
}
