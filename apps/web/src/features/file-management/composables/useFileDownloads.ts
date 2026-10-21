import { onScopeDispose, reactive, ref, watch } from 'vue';
import { useSessionStore } from '@/shared/auth/session-store';
import { saveFile, type TransferProgress } from '@/shared/file-transfer';
import { ApiError } from '@/shared/http/errors';
import type { FileTransferTarget } from '../file-types';
import { useFileContentRequest } from '../queries';

export interface FileDownloadTask {
  file: FileTransferTarget;
  phase: 'receiving' | 'checking' | 'done' | 'error' | 'cancelled';
  progress: TransferProgress | null;
  failure: string;
}

/** 下载只读操作按文件防重复；取消、离开页面、换会话均停止读取，不触发晚到的保存 */
export function useFileDownloads() {
  const read = useFileContentRequest();
  const session = useSessionStore();
  const tasks = ref<FileDownloadTask[]>([]);
  const pending = new Map<string, { task: FileDownloadTask; controller: AbortController }>();
  let disposed = false;

  const reset = () => {
    for (const { controller } of pending.values()) {
      controller.abort();
    }
    pending.clear();
    tasks.value = [];
  };
  watch(() => session.session, reset, { flush: 'sync' });
  onScopeDispose(() => { disposed = true; reset(); });

  async function start(file: FileTransferTarget): Promise<void> {
    if (disposed || pending.has(file.id) || !session.isActive()) {
      return;
    }
    const sentSession = session.session;
    const controller = new AbortController();
    const task = reactive<FileDownloadTask>({ file: { ...file }, phase: 'receiving', progress: null, failure: '' });
    pending.set(file.id, { task, controller });
    tasks.value = [task, ...tasks.value.filter(item => item.file.id !== file.id)];
    const current = () => {
      if (disposed || controller.signal.aborted || session.session !== sentSession) {
        return false;
      }
      if (!session.isActive()) {
        reset();
        return false;
      }
      return true;
    };
    try {
      const result = await read(task.file, controller.signal, progress => {
        if (current()) {
          task.progress = progress;
          task.phase = progress.percent === 100 ? 'checking' : 'receiving';
        }
      });
      if (!current()) {
        return;
      }
      saveFile(result);
      task.phase = 'done';
    } catch (error) {
      if (!current()) {
        return;
      }
      task.phase = error instanceof ApiError && error.kind === 'canceled' ? 'cancelled' : 'error';
      task.failure = error instanceof ApiError ? error.message : '下载未完成，请重试';
    } finally {
      // 取消后同一文件可能已经重试，旧请求的收尾不能移除新的任务
      if (pending.get(file.id)?.controller === controller) {
        pending.delete(file.id);
      }
    }
  }

  const cancel = (task: FileDownloadTask) => {
    const entry = pending.get(task.file.id);
    if (entry?.task === task) {
      entry.controller.abort();
      pending.delete(task.file.id);
      task.phase = 'cancelled';
    }
  };
  const isDownloading = (id: string) => tasks.value.some(task => task.file.id === id
    && (task.phase === 'receiving' || task.phase === 'checking'));
  const clearFinished = () => { tasks.value = tasks.value.filter(task => isDownloading(task.file.id)); };
  return { tasks, start, cancel, isDownloading, clearFinished };
}
