import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import {
  approvalMessage,
  createMessageBackend,
  type MessageBackendOptions,
  resourceMessage,
  tableMessage
} from '@/features/message-center/test-data';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { required } from '@/shared/testing/required';
import { routesWithoutPages } from '../../router/test-routes';
import { MESSAGE_UNAVAILABLE } from '../message-routes';
import { HeaderMessages } from './HeaderMessages';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  // 弹框渲染在 body 下，不归组件管
  document.body.innerHTML = '';
});
afterAll(() => server.close());

// 用真实的路由表：业务按钮能不能点、去哪里，都来自路由
async function mountMessages(role: Role, options: MessageBackendOptions = {}) {
  const backend = createMessageBackend(options);
  server.use(...backend.handlers);
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({
    token: createTestJwtExpiringAt(Date.now() + 3600000),
    user: { loginName: 'u', role }
  });
  const router = createRouter({ history: createMemoryHistory(), routes: routesWithoutPages() });
  await router.push('/current-map');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(HeaderMessages, {
    // 弹框的开关跟着 Element 过渡的钩子，不能用默认的过渡替身
    global: { plugins: [pinia, router, [VueQueryPlugin, { queryClient }]], stubs: { transition: false } },
    attachTo: document.body
  });
  return { wrapper, router, backend };
}

type Mounted = Awaited<ReturnType<typeof mountMessages>>;

const bell = ({ wrapper }: Mounted) => wrapper.get('button');

async function openPanel(mounted: Mounted) {
  await bell(mounted).trigger('click');
  // 关上以后内容仍留在页面里，要等弹框真的打开
  await vi.waitFor(() => expect(bell(mounted).attributes('aria-expanded')).toBe('true'));
  await vi.waitFor(() => expect(document.querySelectorAll('[aria-label="消息列表"] article').length).toBeGreaterThan(0));
}

function panelButton(text: string) {
  return required(
    [...document.querySelectorAll<HTMLButtonElement>('[aria-label="消息列表"] button')].find(
      button => button.textContent === text
    ),
    `按钮 ${text}`
  );
}

describe('HeaderMessages', () => {
  it('角标是未读数，按钮的名称带上未读数', async () => {
    const mounted = await mountMessages(Role.admin);
    await vi.waitFor(() => expect(bell(mounted).attributes('aria-label')).toBe('消息，2 条未读'));
    expect(mounted.wrapper.get('.el-badge__content').text()).toBe('2');
  });

  it('超过 99 条显示 99+；没有未读时不显示角标', async () => {
    const many = Array.from({ length: 120 }, (_, index) => tableMessage({ msgId: `msg-${index}` }));
    const mounted = await mountMessages(Role.admin, { messages: many });
    await vi.waitFor(() => expect(mounted.wrapper.get('.el-badge__content').text()).toBe('99+'));

    const none = await mountMessages(Role.admin, { messages: [resourceMessage()] });
    await vi.waitFor(() => expect(none.backend.requests).toEqual(['unread']));
    expect(none.wrapper.find('.el-badge__content').exists()).toBe(false);
    expect(bell(none).attributes('aria-label')).toBe('消息');
  });

  it('打开时才取全部消息；按 Esc 关闭，焦点回到按钮', async () => {
    const mounted = await mountMessages(Role.admin);
    await vi.waitFor(() => expect(mounted.backend.requests).toEqual(['unread']));

    await openPanel(mounted);
    expect(mounted.backend.requests).toContain('list');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.waitFor(() => expect(bell(mounted).attributes('aria-expanded')).toBe('false'));
    expect(document.activeElement).toBe(bell(mounted).element);
  });

  it('管理员：业务按钮标为已读、关闭弹框，打开系统管理里的申请或统计报表', async () => {
    const mounted = await mountMessages(Role.admin);
    await openPanel(mounted);

    panelButton('去审核').click();
    await vi.waitFor(() => expect(mounted.router.currentRoute.value.fullPath).toBe('/system-management?apply=apply-pending'));
    await vi.waitFor(() => expect(bell(mounted).attributes('aria-expanded')).toBe('false'));
    await vi.waitFor(() => expect(mounted.backend.requests).toContain('read msg-approval'));

    await openPanel(mounted);
    panelButton('查看报表').click();
    await vi.waitFor(() => expect(mounted.router.currentRoute.value.fullPath).toBe('/system-management/statistical-report'));
  });

  it('普通用户：业务按钮禁用，说明数据下载还没有迁移', async () => {
    const mounted = await mountMessages(Role.user, { messages: [approvalMessage(), tableMessage()] });
    await openPanel(mounted);

    for (const text of ['去审核', '查看报表']) {
      expect(panelButton(text).disabled).toBe(true);
    }
    expect(document.querySelector('[aria-label="消息列表"]')?.textContent).toContain(MESSAGE_UNAVAILABLE);
  });
});
