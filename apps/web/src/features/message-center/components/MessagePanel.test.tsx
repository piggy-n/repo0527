import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { required } from '@/shared/testing/required';
import { useMessageCenter } from '../composables/useMessageCenter';
import type { MessageTarget } from '../display';
import {
  approvalMessage,
  createMessageBackend,
  type MessageBackendOptions,
  resourceMessage,
  tableMessage
} from '../test-data';
import { MessagePanel } from './MessagePanel';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let unavailableReason: (target: MessageTarget) => string | null = () => null;
const opened: MessageTarget[] = [];

const Host = defineComponent(() => {
  const center = useMessageCenter(true);
  return () => (
    <MessagePanel
      center={center}
      unavailableReason={unavailableReason}
      onOpen={(target: MessageTarget) => opened.push(target)}
    />
  );
});

function mountPanel(options: MessageBackendOptions = {}) {
  const backend = createMessageBackend(options);
  server.use(...backend.handlers);
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({
    token: createTestJwtExpiringAt(Date.now() + 3600000),
    user: { loginName: 'admin', role: Role.admin }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(Host, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } });
  return { wrapper, backend };
}

afterEach(() => {
  unavailableReason = () => null;
  opened.length = 0;
});

type Wrapper = ReturnType<typeof mountPanel>['wrapper'];

const rows = (wrapper: Wrapper) => wrapper.findAll('article');
const row = (wrapper: Wrapper, title: string) =>
  required(
    rows(wrapper).find(item => item.text().includes(title)),
    `标题为 ${title} 的消息`
  );
const button = (wrapper: Wrapper, text: string) =>
  required(
    wrapper.findAll('button').find(item => item.text() === text),
    `按钮 ${text}`
  );

async function loaded(wrapper: Wrapper) {
  await vi.waitFor(() => expect(rows(wrapper).length).toBeGreaterThan(0));
}

describe('MessagePanel', () => {
  it('标题栏显示未读数；每条有类型、标题、时间和完整正文，未读的有标记', async () => {
    const { wrapper } = mountPanel();
    await loaded(wrapper);
    expect(wrapper.find('header').text()).toContain('2 条未读');
    expect(rows(wrapper).map(item => item.attributes('aria-label'))).toEqual([
      '未读，数据申请待审核',
      '数据准备完成',
      '未读，报表分析通知'
    ]);
    const approval = row(wrapper, '数据申请待审核');
    expect(approval.text()).toContain('审批提醒');
    expect(approval.text()).toContain('王立于2026年10月28日11时29分提交的资源申请需要您审批');
    expect(approval.get('time').attributes('title')).toBe('2026-10-28 11:29:36');
    expect(wrapper.text()).toContain('共 3 条');
  });

  it('点一行或在行上按回车标为已读', async () => {
    const { wrapper, backend } = mountPanel();
    await loaded(wrapper);

    await row(wrapper, '报表分析通知').trigger('click');
    await vi.waitFor(() => expect(row(wrapper, '报表分析通知').attributes('aria-label')).toBe('报表分析通知'));

    await row(wrapper, '数据申请待审核').trigger('keydown', { key: 'Enter' });
    await vi.waitFor(() => expect(backend.requests).toContain('read msg-approval'));
    expect(backend.requests.filter(request => request.startsWith('read'))).toEqual(['read msg-table', 'read msg-approval']);
  });

  it('业务按钮：标为已读并交出目标；去不了时禁用并说明原因', async () => {
    unavailableReason = target => (target.kind === 'reports' ? '数据下载页面迁移后可用' : null);
    const { wrapper, backend } = mountPanel();
    await loaded(wrapper);

    await button(wrapper, '去审核').trigger('click');
    expect(opened).toEqual([{ kind: 'application', applyId: 'apply-pending' }]);
    await vi.waitFor(() => expect(backend.requests).toContain('read msg-approval'));
    // 点击也冒泡到整行，同一条只提交一次
    expect(backend.requests.filter(request => request.startsWith('read'))).toEqual(['read msg-approval']);

    const report = button(wrapper, '查看报表');
    expect(report.attributes('disabled')).toBeDefined();
    expect(row(wrapper, '报表分析通知').text()).toContain('数据下载页面迁移后可用');
    expect(button(wrapper, '查看申请').attributes('disabled')).toBeUndefined();
  });

  it('全部已读：没有未读时禁用', async () => {
    const { wrapper, backend } = mountPanel();
    await loaded(wrapper);

    await button(wrapper, '全部已读').trigger('click');
    await vi.waitFor(() => expect(wrapper.find('header').text()).not.toContain('条未读'));
    expect(backend.requests).toContain('read all');
    expect(button(wrapper, '全部已读').attributes('disabled')).toBeDefined();
    expect(rows(wrapper).every(item => !item.attributes('aria-label')?.startsWith('未读'))).toBe(true);
  });

  it('只看未读；没有时说明', async () => {
    const { wrapper } = mountPanel({ messages: [resourceMessage(), approvalMessage(), tableMessage({ isRead: 'true' })] });
    await loaded(wrapper);

    const unreadOption = required(wrapper.findAll('.el-radio-button input').at(1), '"未读"选项');
    await unreadOption.setValue(true);
    expect(rows(wrapper).map(item => item.attributes('aria-label'))).toEqual(['未读，数据申请待审核']);

    await row(wrapper, '数据申请待审核').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('没有未读消息'));
  });

  it('加载失败时可以重试', async () => {
    const { wrapper, backend } = mountPanel({ failLists: true });
    await vi.waitFor(() => expect(wrapper.text()).toContain('加载失败'));

    backend.control.failLists = false;
    await button(wrapper, '重试').trigger('click');
    await loaded(wrapper);
    expect(wrapper.text()).not.toContain('加载失败');
  });
});
