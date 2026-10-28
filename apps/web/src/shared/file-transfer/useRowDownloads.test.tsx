import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { Role } from '../auth/roles';
import { useSessionStore } from '../auth/session-store';
import { createTestJwtExpiringAt } from '../auth/testing';
import type { TransferProgress } from '../http/client';
import { ApiError } from '../http/errors';
import type { DownloadedFile } from './index';
import { useRowDownloads } from './useRowDownloads';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

interface Target {
  id: string;
}

// 每次读取都挂起，用例决定进度、完成或失败；aborted 记下读取有没有被中止
interface PendingRead {
  id: string;
  signal: AbortSignal;
  progress: (progress: TransferProgress) => void;
  finish: () => void;
  fail: (error: unknown) => void;
}

let downloads: ReturnType<typeof useRowDownloads<Target>>;
let reads: PendingRead[];

function mountHost() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({
    token: createTestJwtExpiringAt(Date.now() + 3600000),
    user: { loginName: 'admin', role: Role.admin }
  });
  reads = [];
  const read = (target: Target, signal: AbortSignal, onProgress: (progress: TransferProgress) => void) =>
    new Promise<DownloadedFile>((resolve, reject) => {
      reads.push({
        id: target.id,
        signal,
        progress: onProgress,
        finish: () => resolve({ blob: new Blob(['数据']), fileName: `${target.id}.zip` }),
        fail: reject
      });
    });
  const Host = defineComponent(() => {
    downloads = useRowDownloads((target: Target) => target.id, read);
    return () => null;
  });
  return mount(Host, { global: { plugins: [pinia] } });
}

// 记下交给浏览器保存的文件名；jsdom 没有 URL.createObjectURL
function stubSave() {
  const saved: string[] = [];
  // 只补上保存要用的两个静态方法，new URL 照常可用（接口模拟要用）
  class TestURL extends URL {
    static override createObjectURL = () => 'blob:test';
    static override revokeObjectURL = () => undefined;
  }
  vi.stubGlobal('URL', TestURL);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push(this.download);
  });
  return saved;
}

const progress = (percent: number | null): TransferProgress => ({
  loaded: 10,
  total: percent === null ? null : 100,
  percent
});

describe('useRowDownloads', () => {
  it('记下进度，读完交给浏览器保存；下载期间同一行不重复下载', async () => {
    const saved = stubSave();
    mountHost();
    const done = downloads.start({ id: 'a' });
    expect(downloads.isDownloading('a')).toBe(true);
    expect(downloads.percentOf('a')).toBeNull();
    // 漏了防重复时第二次的读取会一直挂着：和一个下一轮就结束的等待赛跑
    const nextTurn = new Promise(resolve => setTimeout(() => resolve('pending'), 0));
    const again = await Promise.race([downloads.start({ id: 'a' }), nextTurn]);
    expect(again).toBeNull();
    expect(reads).toHaveLength(1);

    reads[0]?.progress(progress(35));
    expect(downloads.percentOf('a')).toBe(35);
    reads[0]?.finish();

    expect(await done).toEqual({ kind: 'done' });
    expect(saved).toEqual(['a.zip']);
    expect(downloads.isDownloading('a')).toBe(false);
  });

  it('失败时返回原因，不保存；之后可以重新下载', async () => {
    const saved = stubSave();
    mountHost();
    const failed = downloads.start({ id: 'a' });
    reads[0]?.fail(new ApiError({ kind: 'business', message: '任务不存在' }));

    expect(await failed).toEqual({ kind: 'error', message: '任务不存在' });
    expect(saved).toEqual([]);
    expect(downloads.isDownloading('a')).toBe(false);
    void downloads.start({ id: 'a' });
    expect(reads).toHaveLength(2);
  });

  it('页面销毁、换会话时中止读取，晚到的内容不保存、不报告结果', async () => {
    const saved = stubSave();
    const wrapper = mountHost();
    const unmounted = downloads.start({ id: 'a' });
    wrapper.unmount();
    expect(reads[0]?.signal.aborted).toBe(true);
    reads[0]?.finish();
    expect(await unmounted).toBeNull();

    mountHost();
    const switched = downloads.start({ id: 'b' });
    useSessionStore().start({
      token: createTestJwtExpiringAt(Date.now() + 7200000),
      user: { loginName: 'other', role: Role.admin }
    });
    expect(reads[0]?.signal.aborted).toBe(true);
    expect(downloads.isDownloading('b')).toBe(false);
    reads[0]?.finish();
    expect(await switched).toBeNull();
    expect(saved).toEqual([]);
  });
});
