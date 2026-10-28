import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { useApplicationAudit } from './useApplicationAudit';

const server = setupServer();
const cleanups: (() => void)[] = [];
const detail = { apply_id: 'one', apply_name: '调查成果', status: 'pending' };
const success = (data: unknown) => HttpResponse.json({ code: 200, data });

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  server.resetHandlers();
  localStorage.clear();
  vi.restoreAllMocks();
});

function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSessionStore();
  session.start({
    token: createTestJwtExpiringAt(Date.now() + 3600000),
    user: { loginName: 'admin', role: Role.admin }
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let audit!: ReturnType<typeof useApplicationAudit>;
  const wrapper = mount(
    defineComponent(() => {
      audit = useApplicationAudit();
      return () => null;
    }),
    { global: { plugins: [pinia, [VueQueryPlugin, { queryClient: client }]] } }
  );
  cleanups.push(() => {
    wrapper.unmount();
    client.clear();
  });
  server.use(mock.get('/backend/api/apply/:id', ({ params }) => success({ ...detail, apply_id: params.id })));
  return { audit, session, client, wrapper };
}

async function open(audit: ReturnType<typeof useApplicationAudit>) {
  audit.open('one');
  await vi.waitFor(() => expect(audit.editable.value).toBe(true));
}

function holdWrite() {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => {
    release = resolve;
  });
  cleanups.push(release);
  const handler = vi.fn<() => Promise<Response>>(async () => {
    await waiting;
    return success(null);
  });
  server.use(mock.post('/backend/api/apply/status/:id', handler));
  return { handler, release };
}

describe('申请详情与审核', () => {
  it('结果必选、拒绝原因去空格校验；失败保留填写内容，重试成功关闭', async () => {
    const { audit } = setup();
    await open(audit);
    expect(await audit.submit()).toBe(false);
    expect(audit.failure.value).toBe('请选择审核结果');
    audit.decision.value = 'rejected';
    audit.reason.value = '   ';
    expect(await audit.submit()).toBe(false);
    expect(audit.failure.value).toBe('请填写不通过原因');
    audit.reason.value = '  用途不完整  ';
    const reasons: (string | null)[] = [];
    server.use(mock.post('/backend/api/apply/status/:id', ({ request }) => {
      reasons.push(new URL(request.url).searchParams.get('reason'));
      return HttpResponse.json({ code: 500, msg: '审核冲突' });
    }));
    expect(await audit.submit()).toBe(false);
    expect(audit.failure.value).toBe('审核冲突');
    expect(audit.reason.value).toBe('  用途不完整  ');
    expect(reasons).toEqual(['用途不完整']);
    server.use(mock.post('/backend/api/apply/status/:id', () => success(null)));
    expect(await audit.submit()).toBe(true);
    expect(audit.selectedId.value).toBeUndefined();
  });

  it('请求进行中不重复提交；详情读取失败不能提交', async () => {
    const { audit } = setup();
    await open(audit);
    audit.decision.value = 'approved';
    const held = holdWrite();
    const submitting = audit.submit();
    expect(await audit.submit()).toBe(false);
    await vi.waitFor(() => expect(held.handler).toHaveBeenCalledTimes(1));
    held.release();
    expect(await submitting).toBe(true);
    server.use(mock.get('/backend/api/apply/:id', () => HttpResponse.json({ code: 500, msg: '读取失败' })));
    audit.open('two');
    await vi.waitFor(() => expect(audit.loadFailed.value).toBe(true));
    expect(audit.detail.value).toBeUndefined();
    expect(await audit.submit()).toBe(false);
    expect(held.handler).toHaveBeenCalledTimes(1);
  });

  it('调度前换会话，不使用新凭据发送旧审核', async () => {
    const { audit, session } = setup();
    await open(audit);
    audit.decision.value = 'approved';
    const handler = vi.fn<() => Response>(() => success(null));
    server.use(mock.post('/backend/api/apply/status/:id', handler));
    const submitting = audit.submit();
    session.clear();
    expect(await submitting).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('已发送后换会话，晚到成功不刷新新缓存、不报告成功', async () => {
    const { audit, session, client } = setup();
    await open(audit);
    audit.decision.value = 'approved';
    const held = holdWrite();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const submitting = audit.submit();
    await vi.waitFor(() => expect(held.handler).toHaveBeenCalledOnce());
    session.clear();
    held.release();
    expect(await submitting).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
    expect(audit.selectedId.value).toBeUndefined();
  });

  it('组件卸载不取消已发出审核，但不再报告成功或修改弹窗', async () => {
    const { audit, wrapper } = setup();
    await open(audit);
    audit.decision.value = 'approved';
    const held = holdWrite();
    const submitting = audit.submit();
    await vi.waitFor(() => expect(held.handler).toHaveBeenCalledOnce());
    wrapper.unmount();
    held.release();
    expect(await submitting).toBe(false);
  });

  it('切换申请清空草稿，隐藏旧详情；关闭后不保留可提交对象', async () => {
    const { audit } = setup();
    await open(audit);
    audit.reason.value = '旧申请原因';
    audit.decision.value = 'rejected';
    audit.open('two');
    expect(audit.detail.value).toBeUndefined();
    expect(audit.reason.value).toBe('');
    expect(audit.decision.value).toBe('');
    await vi.waitFor(() => expect(audit.detail.value?.apply_id).toBe('two'));
    audit.close();
    await nextTick();
    expect(audit.detail.value).toBeUndefined();
  });
});
