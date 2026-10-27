import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { required } from '@/shared/testing/required';
import { type DataApplicationOwner, useDataApplication } from '../composables/useDataApplication';
import { resourceRow } from '../test-data';
import { DataApplicationDialog } from './DataApplicationDialog';

const server = setupServer();
const clients: QueryClient[] = [];
const releases = new Set<() => void>();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  releases.forEach(release => release());
  releases.clear();
  clients.splice(0).forEach(client => client.clear());
  server.resetHandlers();
  document.body.innerHTML = '';
  localStorage.clear();
});
afterAll(() => server.close());

/** 申请接口：记录收到的正文；hold 时等测试放行，fail 时返回业务失败 */
function backend() {
  const state = { hold: false, fail: false };
  const bodies: unknown[] = [];
  server.use(
    mock.post('/backend/api/apply/create', async ({ request }) => {
      bodies.push(await request.json());
      if (state.hold) {
        await new Promise<void>(resolve => releases.add(resolve));
      }
      if (state.fail) {
        return HttpResponse.json({ code: 500, msg: '申请失败' });
      }
      return HttpResponse.json({ code: 200, msg: '成功', data: null });
    })
  );
  return { state, bodies };
}

function host() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSessionStore();
  session.start({
    token: createTestJwtExpiringAt(Date.now() + 3_600_000),
    user: { loginName: 'admin', role: Role.admin }
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  clients.push(client);
  let owner: DataApplicationOwner | undefined;
  mount(
    defineComponent(() => {
      const application = useDataApplication();
      owner = application;
      return () => <DataApplicationDialog owner={application} />;
    }),
    { attachTo: document.body, global: { plugins: [pinia, [VueQueryPlugin, { queryClient: client }]] } }
  );
  return { owner: required(owner, '下载申请的拥有者'), session };
}

function dialog(): HTMLElement {
  return required(document.querySelector<HTMLElement>('[role="dialog"][aria-label="数据申请提交"]'), '申请弹窗');
}

function button(text: string): HTMLButtonElement {
  const buttons = [...dialog().querySelectorAll('button')];
  return required(buttons.find(item => item.textContent?.trim() === text), `「${text}」按钮`);
}

async function open(owner: DataApplicationOwner, row = resourceRow()) {
  owner.start(row);
  await flushPromises();
}

// 表单项下方的校验提示
function errors(): string[] {
  return [...dialog().querySelectorAll('.el-form-item__error')].map(item => item.textContent?.trim() ?? '');
}

function message(): string {
  return [...document.querySelectorAll('.el-message')].map(item => item.textContent?.trim()).join('；');
}

describe('DataApplicationDialog', () => {
  it('必填项没填时不提交；图层对不上的资源要先选数据需求', async () => {
    const { bodies } = backend();
    const { owner } = host();
    await open(owner, resourceRow({ datasetCode: 'cxjc', layerCode: 'cwjq' }));

    expect(owner.form.layerCode).toBe('');
    button('提交申请').click();
    await vi.waitFor(() => expect(errors()).toEqual(['请选择数据需求', '请选择数据格式', '请输入申请用途']));
    expect(bodies).toEqual([]);
  });

  it('结束时间早于开始时间时提示，不提交', async () => {
    const { bodies } = backend();
    const { owner } = host();
    await open(owner);
    Object.assign(owner.form, { formats: ['Excel'], purpose: '台账', endTime: '2000-01-01 00:00:00' });

    button('提交申请').click();
    await vi.waitFor(() => expect(errors()).toEqual(['开始时间不能晚于结束时间', '结束时间不能早于开始时间']));
    expect(bodies).toEqual([]);
  });

  it('换成不支持的图层时去掉已选的格式', async () => {
    backend();
    const { owner } = host();
    await open(owner);
    owner.form.layerCode = 'csxhjctb_xxp_2022';
    owner.form.formats = ['Excel', 'Word', 'Echarts'];
    await nextTick();

    owner.form.layerCode = 'bgdc_dltb_2022';
    await nextTick();
    expect(owner.form.formats).toEqual(['Excel']);
    expect(owner.formats.value).toEqual(['Excel', 'SHP', 'GDB']);
  });

  it('提交成功后关闭并提示；正文按旧接口的字段', async () => {
    const { bodies } = backend();
    const { owner } = host();
    await open(owner);
    Object.assign(owner.form, { formats: ['Excel', 'GDB'], purpose: ' 年度台账 ', regionPath: ['320000', '320100'] });

    button('提交申请').click();
    await vi.waitFor(() => expect(owner.open.value).toBe(false));
    expect(bodies).toEqual([
      expect.objectContaining({
        applyName: '地类图斑',
        receiverDeptCode: 'jsdxzx',
        layerCode: 'bgdc_dltb_2022',
        xzqdm: '320100',
        dataFormats: 'excel,gdb',
        applyPurpose: '年度台账'
      })
    ]);
    expect(message()).toContain('申请已提交');
  });

  it('提交中不能关闭、不重复提交；失败后保留填写的内容，可以直接重试', async () => {
    const { state, bodies } = backend();
    const { owner } = host();
    await open(owner);
    Object.assign(owner.form, { formats: ['Excel'], purpose: '台账' });
    state.hold = true;
    state.fail = true;

    button('提交申请').click();
    await vi.waitFor(() => expect(owner.pending.value).toBe(true));
    button('提交申请').click();
    owner.close();
    expect(button('取消').disabled).toBe(true);
    expect(owner.open.value).toBe(true);

    releases.forEach(release => release());
    await vi.waitFor(() => expect(owner.pending.value).toBe(false));
    expect(bodies).toHaveLength(1);
    expect(message()).toContain('申请失败');
    expect(owner.open.value).toBe(true);
    expect(owner.form.purpose).toBe('台账');

    state.hold = false;
    state.fail = false;
    button('提交申请').click();
    await vi.waitFor(() => expect(owner.open.value).toBe(false));
    expect(bodies).toHaveLength(2);
  });

  it('提交中换了会话：弹窗关闭，旧申请的结果不提示', async () => {
    const { state } = backend();
    const { owner, session } = host();
    await open(owner);
    Object.assign(owner.form, { formats: ['Excel'], purpose: '台账' });
    state.hold = true;

    button('提交申请').click();
    await vi.waitFor(() => expect(owner.pending.value).toBe(true));
    session.start({
      token: createTestJwtExpiringAt(Date.now() + 7_200_000),
      user: { loginName: 'other', role: Role.admin }
    });
    expect(owner.open.value).toBe(false);

    releases.forEach(release => release());
    await vi.waitFor(() => expect(owner.pending.value).toBe(false));
    expect(message()).toBe('');
  });
});
