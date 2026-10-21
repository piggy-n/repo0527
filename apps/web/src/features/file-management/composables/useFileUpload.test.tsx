import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { configureHttp } from '@/shared/http/configure';
import type { TransferProgress } from '@/shared/http/client';
import * as api from '../api';
import { DEFAULT_CATEGORY_ID } from '../categories';
import { fileKeys } from '../queries';
import { useFileUpload } from './useFileUpload';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); localStorage.clear(); configureHttp({}); });
afterAll(() => server.close());

/** 通过真实 mutation 和 HTTP 观察写操作的边界，不模拟 axios */
function mountUpload() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSessionStore();
  session.start({ token: createTestJwtExpiringAt(Date.now() + 3_600_000), user: { loginName: 'test', role: Role.user } });
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: 3 } } });
  const key = fileKeys.page({ categoryId: DEFAULT_CATEGORY_ID, pageNo: 1, pageSize: 20 });
  queryClient.setQueryData(key, { marker: '当前缓存' });
  let upload!: ReturnType<typeof useFileUpload>;
  const wrapper = mount(defineComponent({
    setup() { upload = useFileUpload(); return () => null; }
  }), { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } });
  upload.open(DEFAULT_CATEGORY_ID);
  upload.fields.tag = '综合';
  upload.fields.year = '2025';
  upload.fields.remark = '本次备注';
  upload.addFiles([new File(['测试内容'], '测试.txt')]);
  return { upload, wrapper, session, queryClient, key };
}

function holdUpload(success = true) {
  const forms: string[] = [];
  let release: (() => void) | undefined;
  server.use(mock.post('/backend/file/upload', async ({ request }) => {
    forms.push(await request.text());
    await new Promise<void>(resolve => { release = resolve; });
    return HttpResponse.json(success ? { code: 200 } : { code: 500, msg: '上传失败' });
  }));
  return { forms, release: () => release?.() };
}

describe('useFileUpload', () => {
  it('校验文件及元数据，未通过时不进入发送状态', async () => {
    const { upload } = mountUpload();
    upload.removeFile(0);
    upload.fields.categoryId = 'policy';
    upload.fields.tag = '无效标签';
    upload.fields.year = String(new Date().getFullYear() + 1);
    expect(await upload.submit()).toBe(false);
    expect(upload.errors.value).toEqual({
      categoryId: '请选择具体分类', year: '请选择有效年份', tag: '请选择业务类型标签', files: '请至少选择一个文件'
    });
    expect(upload.phase.value).toBe('draft');
  });

  it('防重复提交，关窗清草稿但已发送的快照仍成功并使列表失效', async () => {
    const pending = holdUpload();
    const { upload, queryClient, key } = mountUpload();
    const done = upload.submit();
    upload.close();
    expect(await upload.submit()).toBe(false);
    expect(upload.files.value).toEqual([]);
    expect(upload.fields.remark).toBe('');
    upload.open(DEFAULT_CATEGORY_ID);
    expect(upload.progressOnly.value).toBe(true);
    await vi.waitFor(() => expect(pending.forms).toHaveLength(1));
    expect(pending.forms[0]).toContain('name="year"\r\n\r\n2025');
    expect(pending.forms[0]).toContain('name="remark"\r\n\r\n本次备注');
    expect(pending.forms[0]?.match(/name="files"/g)).toHaveLength(1);
    pending.release();
    expect(await done).toBe(true);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(upload.phase.value).toBe('success');
    expect(upload.files.value).toEqual([]);
  });

  it('卸载不取消写操作，同会话的缓存失效，但不回写旧界面', async () => {
    const pending = holdUpload();
    const { upload, wrapper, queryClient, key } = mountUpload();
    const done = upload.submit();
    await vi.waitFor(() => expect(pending.forms).toHaveLength(1));
    wrapper.unmount();
    const phase = upload.phase.value;
    pending.release();
    expect(await done).toBe(false);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(upload.phase.value).toBe(phase);
  });

  it.each(['clear', 'replace', 'expire'] as const)('会话 %s 后成功结果不污染新界面或查询缓存', async action => {
    const pending = holdUpload();
    const { upload, session, queryClient, key } = mountUpload();
    const done = upload.submit();
    await vi.waitFor(() => expect(pending.forms).toHaveLength(1));
    if (action === 'clear') {
      session.clear();
    } else if (action === 'replace') {
      session.start({ token: session.token!, user: { loginName: 'new', role: Role.user } });
    } else {
      // 时间经过导致失效，不替换会话对象
      vi.spyOn(session, 'isActive').mockReturnValue(false);
    }
    pending.release();
    expect(await done).toBe(false);
    expect(upload.phase.value).not.toBe('success');
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it('mutation 尚未开始发送就换会话，不使用新凭据发送旧草稿', async () => {
    const { upload, session } = mountUpload();
    const send = vi.spyOn(api, 'uploadFiles');
    const done = upload.submit();
    session.start({ token: session.token!, user: { loginName: 'new', role: Role.user } });
    expect(await done).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('失败保持打开的草稿、不自动重试且不重复全局提示，关闭后清空', async () => {
    const pending = holdUpload(false);
    const onError = vi.fn<() => void>();
    configureHttp({ onError });
    const { upload, queryClient, key } = mountUpload();
    const done = upload.submit();
    await vi.waitFor(() => expect(pending.forms).toHaveLength(1));
    pending.release();
    expect(await done).toBe(false);
    expect(pending.forms).toHaveLength(1);
    expect(upload.phase.value).toBe('error');
    expect(upload.failure.value).toBe('上传失败');
    expect(upload.files.value).toHaveLength(1);
    expect(upload.fields.remark).toBe('本次备注');
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    upload.close();
    expect(upload.files.value).toEqual([]);
    expect(upload.fields.remark).toBe('');
  });

  it('进度总量未知不伪造百分比，发送 100% 仍等待业务成功；卸载后忽略进度', async () => {
    let progress: ((value: TransferProgress) => void) | undefined;
    let finish: (() => void) | undefined;
    vi.spyOn(api, 'uploadFiles').mockImplementation((_input, onProgress) => {
      progress = onProgress;
      return new Promise<undefined>(resolve => { finish = () => resolve(undefined); });
    });
    const { upload, wrapper } = mountUpload();
    const done = upload.submit();
    await vi.waitFor(() => expect(progress).toBeTypeOf('function'));
    progress?.({ loaded: 12, total: null, percent: null });
    expect(upload.progress.value?.percent).toBeNull();
    expect(upload.phase.value).toBe('sending');
    progress?.({ loaded: 24, total: 24, percent: 100 });
    expect(upload.phase.value).toBe('processing');
    wrapper.unmount();
    progress?.({ loaded: 4, total: 24, percent: 17 });
    expect(upload.progress.value?.percent).toBe(100);
    finish?.();
    expect(await done).toBe(false);
  });
});
