import { onScopeDispose, shallowRef, watch } from 'vue';
import { useSessionStore } from '../auth/session-store';
import type { TransferProgress } from '../http/client';
import { ApiError } from '../http/errors';
import { type DownloadedFile, saveFile } from './index';

/** 一次下载的结果；null 表示没有开始（这一行已在下载），或被页面销毁、换会话中止 */
export type RowDownloadResult = { kind: 'done' } | { kind: 'error'; message: string } | null;

/** 表格、弹窗读取的下载状态 */
export interface RowDownloadState {
  isDownloading: (id: string) => boolean;
  /** 0～100；还没有进度或总量未知时是 null */
  percentOf: (id: string) => number | null;
}

type ReadFile<Target> = (
  target: Target,
  signal: AbortSignal,
  onProgress: (progress: TransferProgress) => void
) => Promise<DownloadedFile>;

/**
 * 列表行内的下载（系统管理的申请和统计报表，ADR 0091）：按 ID 防重复，记下每行的进度，读完交给浏览器保存；
 * 不渲染、不提示。下载是只读操作：页面销毁、换会话都中止读取，晚到的内容不交给浏览器（同文件管理的 useFileDownloads）
 */
export function useRowDownloads<Target>(identify: (target: Target) => string, read: ReadFile<Target>) {
  const session = useSessionStore();
  // 进行中的下载：ID → 进度；整体替换，界面跟着更新
  const progress = shallowRef<ReadonlyMap<string, TransferProgress | null>>(new Map());
  const controllers = new Map<string, AbortController>();
  let disposed = false;

  function setProgress(id: string, value: TransferProgress | null | undefined) {
    const next = new Map(progress.value);
    if (value === undefined) {
      next.delete(id);
    } else {
      next.set(id, value);
    }
    progress.value = next;
  }

  function abortAll() {
    for (const controller of controllers.values()) {
      controller.abort();
    }
    controllers.clear();
    progress.value = new Map();
  }

  watch(() => session.token, abortAll, { flush: 'sync' });
  onScopeDispose(() => {
    disposed = true;
    abortAll();
  });

  async function start(target: Target): Promise<RowDownloadResult> {
    const id = identify(target);
    if (disposed || controllers.has(id)) {
      return null;
    }
    const controller = new AbortController();
    controllers.set(id, controller);
    setProgress(id, null);
    try {
      // 中止后 shared/http 不再上报进度，回调里不用再判断
      const file = await read(target, controller.signal, value => setProgress(id, value));
      if (controller.signal.aborted) {
        return null;
      }
      saveFile(file);
      return { kind: 'done' };
    } catch (error) {
      if (controller.signal.aborted) {
        return null;
      }
      return { kind: 'error', message: error instanceof ApiError ? error.message : '下载未完成，请重试' };
    } finally {
      // 中止后同一行可能已经重新下载，旧读取的收尾不能移除新的记录
      if (controllers.get(id) === controller) {
        controllers.delete(id);
        setProgress(id, undefined);
      }
    }
  }

  const state: RowDownloadState = {
    isDownloading: id => progress.value.has(id),
    percentOf: id => progress.value.get(id)?.percent ?? null
  };

  return { start, ...state };
}
