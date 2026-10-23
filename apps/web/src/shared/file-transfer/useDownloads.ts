import { onScopeDispose, shallowReactive, shallowRef, watch } from 'vue';
import { useSessionStore } from '../auth/session-store';
import { ApiError } from '../http/errors';
import { saveFile, type DownloadedFile, type TransferProgress } from './index';

/** 下载身份与显示名称，接口参数由业务目标扩展 */
export interface DownloadTarget {
  id: string;
  name: string;
}

type DownloadRequest<Target> = (
  target: Target,
  signal: AbortSignal,
  onProgress: (progress: TransferProgress) => void
) => Promise<DownloadedFile>;

/** checking：内容已收完，shared/http 正在检查它是不是错误信封；done 只表示交给了浏览器，不表示已存到磁盘 */
export type DownloadPhase = 'receiving' | 'checking' | 'done' | 'error' | 'canceled';

export interface DownloadTask<Target extends DownloadTarget = DownloadTarget> {
  file: Target;
  phase: DownloadPhase;
  progress: TransferProgress | null;
  failure: string;
}

/**
 * 文件下载的任务列表：按文件 ID 防重复，每个任务可以单独取消和重试；不渲染、不提示。
 * 下载是只读操作：取消、页面销毁、换会话都中止读取，晚到的内容不交给浏览器保存
 */
export function useDownloads<Target extends DownloadTarget>(request: DownloadRequest<Target>) {
  const session = useSessionStore();
  const tasks = shallowRef<DownloadTask<Target>[]>([]);
  // 进行中的读取，按文件 ID；取消和收尾时要核对是不是同一次读取
  const running = new Map<string, { task: DownloadTask<Target>; controller: AbortController }>();
  let disposed = false;

  function reset() {
    for (const { controller } of running.values()) {
      controller.abort();
    }
    running.clear();
    tasks.value = [];
  }

  // 换会话时上一个会话的下载不再继续，记录也不留在界面上
  watch(() => session.token, reset, { flush: 'sync' });
  onScopeDispose(() => {
    disposed = true;
    reset();
  });

  async function start(file: Target): Promise<void> {
    if (disposed || running.has(file.id)) {
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    // 复制一份：表格换页、刷新后，任务仍指向发起时的文件
    const task = shallowReactive<DownloadTask<Target>>({
      file: { ...file }, phase: 'receiving', progress: null, failure: ''
    });
    running.set(file.id, { task, controller });
    // 同一文件重新下载时替换它的旧任务，新任务排在最前
    tasks.value = [task, ...tasks.value.filter(item => item.file.id !== file.id)];
    try {
      // 中止后 shared/http 不再上报进度，回调里不用再判断
      const result = await request(task.file, signal, progress => {
        task.progress = progress;
        task.phase = progress.percent === 100 ? 'checking' : 'receiving';
      });
      if (signal.aborted) {
        return;
      }
      saveFile(result);
      task.phase = 'done';
    } catch (error) {
      // 取消时状态已由 cancel 设置；页面销毁、换会话时任务已清空
      if (signal.aborted) {
        return;
      }
      task.phase = 'error';
      task.failure = error instanceof ApiError ? error.message : '下载未完成，请重试';
    } finally {
      // 取消后同一文件可能已经重新下载，旧读取的收尾不能移除新的记录
      if (running.get(file.id)?.controller === controller) {
        running.delete(file.id);
      }
    }
  }

  function cancel(task: DownloadTask) {
    const entry = running.get(task.file.id);
    if (entry?.task !== task) {
      return;
    }
    entry.controller.abort();
    running.delete(task.file.id);
    task.phase = 'canceled';
  }

  // 按任务状态判断，界面能随之更新（running 不是响应式的）
  const isDownloading = (id: string) =>
    tasks.value.some(task => task.file.id === id && (task.phase === 'receiving' || task.phase === 'checking'));

  /** 清除已结束（完成、失败、取消）的任务，进行中的保留 */
  function clearFinished() {
    tasks.value = tasks.value.filter(task => isDownloading(task.file.id));
  }

  /** 重试仍使用发起时的业务参数，不依赖表格当前页 */
  async function retry(id: string): Promise<void> {
    const task = tasks.value.find(item => item.file.id === id);
    if (task) {
      await start(task.file);
    }
  }

  return { tasks, start, retry, cancel, isDownloading, clearFinished };
}
