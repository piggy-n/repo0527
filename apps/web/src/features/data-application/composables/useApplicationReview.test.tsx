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
import { ApiError } from '@/shared/http/errors';
import type { AuditSubmission } from '../queries';
import { approvedRecord, envelope, pendingRecord } from '../test-data';
import { useApplicationReview } from './useApplicationReview';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());

// apply-pending 是待审核，apply-approved 已审核通过，missing 不存在；hold 时详情接口挂起，调用 release 才返回，
// waiting 是已经到达、还挂着的请求数
function mockDetails({ hold = false } = {}) {
  const held: (() => void)[] = [];
  server.use(
    mock.get('/backend/api/apply/:id', async ({ params }) => {
      if (hold) {
        await new Promise<void>(resolve => {
          held.push(resolve);
        });
      }
      const records: Record<string, Record<string, unknown>> = {
        'apply-pending': pendingRecord(),
        'apply-approved': approvedRecord()
      };
      return HttpResponse.json(envelope(records[String(params.id)] ?? null));
    })
  );
  const release = () => {
    for (const resolve of held.splice(0)) {
      resolve();
    }
  };
  return { release, waiting: () => held.length };
}

let applyId: ReturnType<typeof ref<string | null>>;
let review: ReturnType<typeof useApplicationReview>;
let send: ReturnType<typeof vi.fn<(submission: AuditSubmission) => Promise<unknown>>>;

function mountHost() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({
    token: createTestJwtExpiringAt(Date.now() + 3600000),
    user: { loginName: 'admin', role: Role.admin }
  });
  send = vi.fn<(submission: AuditSubmission) => Promise<unknown>>().mockResolvedValue(undefined);
  const Host = defineComponent(() => {
    applyId = ref<string | null>(null);
    review = useApplicationReview(() => applyId.value ?? null, send);
    return () => null;
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(Host, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } });
}

async function openPending() {
  mockDetails();
  const wrapper = mountHost();
  applyId.value = 'apply-pending';
  await vi.waitFor(() => expect(review.state.value).toBe('ready'));
  return wrapper;
}

describe('useApplicationReview', () => {
  it('没有打开时是 closed；打开后读取中，读到后是 ready，待审核的是审核模式', async () => {
    const { release, waiting } = mockDetails({ hold: true });
    mountHost();
    expect(review.state.value).toBe('closed');

    applyId.value = 'apply-pending';
    await vi.waitFor(() => expect(waiting()).toBe(1));
    expect(review.state.value).toBe('loading');
    release();
    await vi.waitFor(() => expect(review.state.value).toBe('ready'));
    expect(review.application.value?.id).toBe('apply-pending');
    expect(review.mode.value).toBe('audit');
  });

  it('已经审核过的申请只查看；不存在的申请是 missing', async () => {
    mockDetails();
    mountHost();
    applyId.value = 'apply-approved';
    await vi.waitFor(() => expect(review.state.value).toBe('ready'));
    expect(review.mode.value).toBe('view');

    applyId.value = 'missing';
    await vi.waitFor(() => expect(review.state.value).toBe('missing'));
    expect(review.application.value).toBeNull();
  });

  it('读取失败是 error，重试成功后是 ready', async () => {
    let fail = true;
    server.use(
      mock.get('/backend/api/apply/:id', () =>
        fail ? HttpResponse.json({ success: false, code: 500, msg: '系统异常' }) : HttpResponse.json(envelope(pendingRecord())))
    );
    mountHost();
    applyId.value = 'apply-pending';
    await vi.waitFor(() => expect(review.state.value).toBe('error'));

    fail = false;
    review.retry();
    await vi.waitFor(() => expect(review.state.value).toBe('ready'));
  });

  it('换了一条申请：新的读到之前不显示上一条，审核意见从头填', async () => {
    const { release, waiting } = mockDetails({ hold: true });
    mountHost();
    applyId.value = 'apply-pending';
    await vi.waitFor(() => expect(waiting()).toBe(1));
    release();
    await vi.waitFor(() => expect(review.state.value).toBe('ready'));
    review.form.approved = false;
    review.form.reason = '原因';

    applyId.value = 'apply-approved';
    expect(review.form).toEqual({ approved: true, reason: '' });
    expect(review.application.value).toBeNull();
    expect(review.state.value).toBe('loading');
    await vi.waitFor(() => expect(waiting()).toBe(1));
    release();
    await vi.waitFor(() => expect(review.application.value?.id).toBe('apply-approved'));
  });

  it('提交时原因去掉首尾空格，带上提交时的会话；成功的结果带着申请 ID', async () => {
    await openPending();
    review.form.approved = false;
    review.form.reason = '  用途不明确 ';

    expect(await review.submit()).toEqual({ kind: 'success', id: 'apply-pending', approved: false });
    expect(send).toHaveBeenCalledWith({
      audit: { id: 'apply-pending', approved: false, reason: '用途不明确' },
      token: useSessionStore().token
    });
  });

  it('失败时返回原因、保留填写的内容；提交期间不重复提交', async () => {
    await openPending();
    const failures: ((error: unknown) => void)[] = [];
    send.mockImplementation(() => new Promise((_resolve, fail) => {
      failures.push(fail);
    }));
    review.form.reason = '保留';

    const first = review.submit();
    expect(review.pending.value).toBe(true);
    expect(await review.submit()).toBeNull();
    failures[0]?.(new ApiError({ kind: 'business', message: '申请已审核' }));

    expect(await first).toEqual({ kind: 'error', message: '申请已审核' });
    expect(review.form.reason).toBe('保留');
    expect(review.pending.value).toBe(false);
    expect(send).toHaveBeenCalledOnce();
  });

  it('不是待审核的申请不提交', async () => {
    mockDetails();
    mountHost();
    applyId.value = 'apply-approved';
    await vi.waitFor(() => expect(review.state.value).toBe('ready'));

    expect(await review.submit()).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('提交期间页面销毁或换了会话：照常完成，但不报告结果', async () => {
    const wrapper = await openPending();
    const sends: (() => void)[] = [];
    send.mockImplementation(() => new Promise<void>(done => {
      sends.push(done);
    }));
    const unmounted = review.submit();
    wrapper.unmount();
    sends[0]?.();
    expect(await unmounted).toBeNull();

    await openPending();
    send.mockImplementation(() => new Promise<void>(done => {
      sends.push(done);
    }));
    const switched = review.submit();
    useSessionStore().start({
      token: createTestJwtExpiringAt(Date.now() + 7200000),
      user: { loginName: 'other', role: Role.admin }
    });
    sends[1]?.();
    expect(await switched).toBeNull();
  });
});
