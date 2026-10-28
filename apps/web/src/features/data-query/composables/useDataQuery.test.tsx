import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref, shallowRef } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { required } from '@/shared/testing/required';
import * as api from '../api';
import type { QueryModule } from '../types';
import { useDataQuery } from './useDataQuery';
import type { QueryDrawing } from './useQueryDrawing';

const server = setupServer();
const cleanups: (() => void)[] = [];
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  server.resetHandlers();
  localStorage.clear();
});

function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSessionStore();
  session.start({
    token: createTestJwtExpiringAt(Date.now() + 3600000),
    user: { loginName: 'test', role: Role.admin }
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const drawing: Pick<QueryDrawing, 'geometry' | 'stop' | 'clear'> = {
    geometry: shallowRef(null),
    stop: vi.fn<() => void>(),
    clear: vi.fn<() => void>()
  };
  const module = ref<QueryModule>('city');
  let model: ReturnType<typeof useDataQuery> | undefined;
  const wrapper = mount(
    defineComponent(() => {
      model = useDataQuery(module, drawing);
      return () => null;
    }),
    { global: { plugins: [pinia, [VueQueryPlugin, { queryClient: client }]] } }
  );
  cleanups.push(() => {
    wrapper.unmount();
    client.clear();
  });
  return { model: required(model, '数据查询的拥有者'), module, drawing, session, wrapper, client };
}

describe('数据查询快照与异步状态', () => {
  it('编辑不改已提交条件，翻页与导出仍使用原查询；新查询回到第一页', async () => {
    const requests: URLSearchParams[] = [];
    server.use(mock.get('/backend/api/query/attr/page', ({ request }) => {
      requests.push(new URL(request.url).searchParams);
      return HttpResponse.json({ total: 25, list: [{ name: '学校' }] });
    }));
    const { model } = setup();
    model.region.value = '320102';
    expect(model.search()).toBe(true);
    await vi.waitFor(() => expect(model.result.value?.total).toBe(25));
    const original = model.submitted.value;
    model.region.value = '320106';
    model.conditions.value = [];
    expect(model.changed.value).toBe(true);
    model.page.value = 2;
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    await vi.waitFor(() => expect(model.result.value?.total).toBe(25));
    expect(requests[1].get('xzqdm')).toBe('320102');
    expect(requests[1].get('conditions')).toBe(original?.conditions);
    expect(requests[1].get('pageNum')).toBe('2');
    const start = vi.spyOn(model.downloads, 'start').mockResolvedValue();
    model.exportResults(['excel']);
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ snapshot: original, formats: ['excel'] }));
    model.search();
    expect(model.page.value).toBe(1);
    expect(model.submitted.value?.scope).toEqual({ kind: 'region', code: '320106' });
    expect(model.changed.value).toBe(false);
  });

  it('错误的新条件先作废旧结果，不能导出上一轮；缺少空间范围不发请求', async () => {
    server.use(mock.get('/backend/api/query/attr/page', () => HttpResponse.json({ total: 1, list: [{}] })));
    const { model, drawing } = setup();
    model.search();
    await vi.waitFor(() => expect(model.result.value?.total).toBe(1));
    model.region.value = 'bad-code';
    expect(model.search()).toBe(false);
    expect(model.submitted.value).toBeNull();
    expect(model.result.value).toBeUndefined();
    const start = vi.spyOn(model.downloads, 'start').mockResolvedValue();
    model.exportResults(['excel']);
    expect(start).not.toHaveBeenCalled();
    model.reset();
    model.mode.value = 'spatial';
    await nextTick();
    expect(model.search()).toBe(false);
    expect(model.error.value).toContain('绘制查询范围');
    expect(drawing.stop).toHaveBeenCalled();
  });

  it('翻页失败保留总数，重试后总数减少则返回最后有效页', async () => {
    let fail = true;
    server.use(mock.get('/backend/api/query/attr/page', ({ request }) => {
      const page = new URL(request.url).searchParams.get('pageNum');
      if (page === '2' && fail) {
        return HttpResponse.json({ code: 500, msg: '查询失败' });
      }
      return HttpResponse.json({ total: fail ? 25 : 1, list: [{ name: '学校' }] });
    }));
    const { model } = setup();
    model.search();
    await vi.waitFor(() => expect(model.total.value).toBe(25));
    model.page.value = 2;
    await vi.waitFor(() => expect(model.pageQuery.isError.value).toBe(true));
    expect(model.total.value).toBe(25);
    expect(model.result.value).toBeUndefined();
    fail = false;
    await model.pageQuery.refetch();
    await vi.waitFor(() => expect(model.page.value).toBe(1));
    await vi.waitFor(() => expect(model.result.value?.total).toBe(1));
    expect(model.total.value).toBe(1);
  });

  it.each(['reset', 'session', 'unmount'] as const)('请求中 %s 会取消读取，晚到结果不复活', async action => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    cleanups.push(release);
    let received = false;
    server.use(mock.get('/backend/api/query/attr/page', async () => {
      received = true;
      await waiting;
      return HttpResponse.json({ total: 1, list: [{ name: '迟到结果' }] });
    }));
    const fetchPage = vi.spyOn(api, 'fetchQueryPage');
    cleanups.push(() => fetchPage.mockRestore());
    const { model, session, wrapper, client } = setup();
    model.search();
    await vi.waitFor(() => expect(received).toBe(true));
    const [, , signal] = required(fetchPage.mock.calls[0], '分页读取的调用');
    if (action === 'reset') {
      model.reset();
    } else if (action === 'session') {
      // 和 app 的 endSession 一样：先清空查询缓存，再清空会话
      client.clear();
      session.clear();
    } else {
      wrapper.unmount();
    }
    // MSW 的 XHR request.signal 不转发取消，直接看交给接口函数的信号；重置后查询要到下一轮调度才换 key
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    release();
    await nextTick();
    expect(model.result.value).toBeUndefined();
  });

  it('普通 HTTP 的内网没有 crypto.randomUUID，仍能提交查询', async () => {
    server.use(mock.get('/backend/api/query/attr/page', () => HttpResponse.json({ total: 1, list: [{ name: '学校' }] })));
    // 非安全上下文只有 getRandomValues，没有 randomUUID
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    cleanups.push(() => vi.unstubAllGlobals());
    const { model } = setup();
    expect(model.search()).toBe(true);
    expect(model.error.value).toBe('');
    await vi.waitFor(() => expect(model.result.value?.total).toBe(1));
  });

  it('同一账号在其他标签页重新登录只换了 token，条件和结果保留', async () => {
    server.use(mock.get('/backend/api/query/attr/page', () => HttpResponse.json({ total: 1, list: [{ name: '学校' }] })));
    const { model, session } = setup();
    model.region.value = '320102';
    model.search();
    await vi.waitFor(() => expect(model.result.value?.total).toBe(1));
    const submitted = model.submitted.value;
    session.start({
      token: createTestJwtExpiringAt(Date.now() + 7200000),
      user: { loginName: 'test', role: Role.admin }
    });
    await nextTick();
    expect(model.region.value).toBe('320102');
    expect(model.submitted.value).toBe(submitted);
    expect(model.result.value?.total).toBe(1);
  });

  it('切换模块重置旧图层与条件，后两个模块没有伪造配置', async () => {
    const { model, module, drawing } = setup();
    model.mode.value = 'advanced';
    model.advanced.value = 'QUOTA > 2';
    module.value = 'land';
    await nextTick();
    expect(model.mode.value).toBe('attribute');
    expect(model.layerCode.value).toBe('bgdc_czcdyd_2022');
    expect(model.advanced.value).toBe('');
    module.value = 'forest';
    await nextTick();
    expect(model.layers.value).toEqual([]);
    expect(model.layer.value).toBeUndefined();
    expect(drawing.clear).toHaveBeenCalled();
  });
});
