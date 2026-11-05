import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import type { ApplicationPageParams } from './api';
import { useApplicationPageQuery, useApplicationQuery, useAuditApplicationMutation } from './queries';
import { applicationPageResponse, envelope, pendingRecord } from './test-data';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
  queryClient.clear();
});
afterAll(() => server.close());

const firstPage: ApplicationPageParams = { name: '', status: '', prepare: '', pageNum: 1, pageSize: 20 };

let openId: ReturnType<typeof ref<string | null>>;
let page: ReturnType<typeof useApplicationPageQuery>;
let detail: ReturnType<typeof useApplicationQuery>;
let audit: ReturnType<typeof useAuditApplicationMutation>;
let queryClient: QueryClient;

const Host = defineComponent(() => {
  openId = ref<string | null>(null);
  page = useApplicationPageQuery(firstPage);
  detail = useApplicationQuery(() => openId.value ?? null);
  audit = useAuditApplicationMutation();
  return () => null;
});

const newSession = () => ({
  token: createTestJwtExpiringAt(Date.now() + 7200000),
  user: { loginName: 'other', role: Role.admin }
});

// 每个用例用新的 QueryClient，缓存不在用例之间残留
function mountHost() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({
    token: createTestJwtExpiringAt(Date.now() + 3600000),
    user: { loginName: 'admin', role: Role.admin }
  });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount(Host, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } });
}

// 记下每次请求；hold 时审核接口挂起，用例调用 audits 里的函数才返回
function mockServer({ hold = true } = {}) {
  const counts = { list: 0, detail: 0, audit: 0 };
  const audits: (() => void)[] = [];
  server.use(
    mock.post('/backend/api/apply/list', () => {
      counts.list += 1;
      return HttpResponse.json(applicationPageResponse([pendingRecord()]));
    }),
    mock.get('/backend/api/apply/:id', ({ params }) => {
      counts.detail += 1;
      return HttpResponse.json(envelope(params.id === 'missing' ? null : pendingRecord({ apply_id: params.id })));
    }),
    mock.post('/backend/api/apply/status/:id', async () => {
      counts.audit += 1;
      if (hold) {
        await new Promise<void>(resolve => {
          audits.push(resolve);
        });
      }
      return HttpResponse.json(envelope(null));
    })
  );
  return { counts, audits };
}

describe('useApplicationQuery', () => {
  it('没有 ID 时不请求；有 ID 时结果标上 ID，申请不存在时是 null', async () => {
    const { counts } = mockServer();
    mountHost();
    await vi.waitFor(() => expect(page.data.value?.list).toHaveLength(1));
    expect(counts.detail).toBe(0);

    openId.value = 'apply-1';
    await vi.waitFor(() => expect(detail.data.value?.id).toBe('apply-1'));
    expect(detail.data.value?.application?.id).toBe('apply-1');

    openId.value = 'missing';
    await vi.waitFor(() => expect(detail.data.value).toEqual({ id: 'missing', application: null }));
  });
});

describe('useAuditApplicationMutation', () => {
  it('成功后重新请求列表和打开的申请，刷新完才算完成', async () => {
    const { counts, audits } = mockServer();
    mountHost();
    openId.value = 'apply-1';
    await vi.waitFor(() => expect(detail.data.value?.id).toBe('apply-1'));
    const before = { ...counts };

    let settled = false;
    const done = (async () => {
      await audit.mutateAsync({ audit: { id: 'apply-1', approved: true, reason: '' }, token: useSessionStore().token });
      settled = true;
    })();
    await vi.waitFor(() => expect(audits).toHaveLength(1));
    expect(settled).toBe(false);

    audits[0]?.();
    await done;
    expect(counts.list).toBe(before.list + 1);
    expect(counts.detail).toBe(before.detail + 1);
  });

  // 审核接口不挂起：漏了核对时请求会成功返回，断言失败而不是等到超时
  it('提交后、发请求前换了会话：不发送旧会话的审核，以取消结束', async () => {
    const { counts } = mockServer({ hold: false });
    mountHost();
    const session = useSessionStore();
    const done = audit.mutateAsync({ audit: { id: 'apply-1', approved: true, reason: '' }, token: session.token });
    session.start(newSession());
    await expect(done).rejects.toMatchObject({ kind: 'canceled' });
    expect(counts.audit).toBe(0);
  });

  it('发送期间换了会话：照常完成，但不刷新新会话的缓存', async () => {
    const { counts, audits } = mockServer();
    mountHost();
    await vi.waitFor(() => expect(page.data.value?.list).toHaveLength(1));
    const session = useSessionStore();
    const done = audit.mutateAsync({ audit: { id: 'apply-1', approved: false, reason: '原因' }, token: session.token });
    await vi.waitFor(() => expect(audits).toHaveLength(1));
    session.start(newSession());
    const listBefore = counts.list;

    audits[0]?.();
    await done;
    expect(counts.list).toBe(listBefore);
  });
});
