import 'element-plus/dist/index.css';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { required } from '@/shared/testing/required';
import type { Message } from '../api';
import { MESSAGE_BATCH, useMessageCenter } from '../composables/useMessageCenter';
import { messageKeys } from '../queries';
import { MessagePanel } from './MessagePanel';

// 真实的布局（ADR 0040）：标题栏和筛选固定、只有列表滚动，滚到底接着显示，窄屏不出横向滚动

// 与页面一致的令牌，feature 测试不反向导入 app
const TOKENS = {
  '--space-xs': '4px',
  '--space-sm': '8px',
  '--space-md': '12px',
  '--space-lg': '16px',
  '--font-size-base': '14px',
  '--font-size-xs': '12px',
  '--line-height-compact': '18px'
};

const LONG_TITLE = '数据申请待审核：南京市主城区学校点位（含新建校区与九年一贯制学校的补充调查成果）';
// 连续的字母数字中间不能断行，要靠 overflow-wrap 换行
const LONG_CONTENT = `王立于2026年10月28日11时29分提交的资源申请需要您审批，附件编号${'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(3)}`;

function messages(count: number): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `msg-${index}`,
    category: index === 0 ? 'approval' : 'table',
    title: index === 0 ? LONG_TITLE : '报表分析通知',
    content: index === 0 ? LONG_CONTENT : '基本统计报表_区级',
    createdAt: '2026-10-14 14:28:00',
    read: index % 2 === 1,
    applyId: index === 0 ? 'apply-1' : null
  }));
}

const mounted: VueWrapper[] = [];
const hosts: HTMLElement[] = [];

beforeAll(() => {
  Object.entries(TOKENS).forEach(([name, value]) => document.documentElement.style.setProperty(name, value));
});

afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount());
  hosts.splice(0).forEach(host => host.remove());
});

// 缓存里先放好数据、不过期：用真实的组合式函数，不发请求
function mountPanel({ count, width }: { count: number; width: number }) {
  const host = document.body.appendChild(document.createElement('div'));
  hosts.push(host);
  host.style.width = `${width}px`;
  host.style.setProperty('--message-panel-max-height', '480px');
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const list = messages(count);
  queryClient.setQueryData(messageKeys.list(), list);
  queryClient.setQueryData(
    messageKeys.unread(),
    list.filter(message => !message.read)
  );
  const Host = defineComponent(() => {
    const center = useMessageCenter(true);
    return () => <MessagePanel center={center} />;
  });
  mounted.push(
    mount(Host, { attachTo: host, global: { plugins: [createPinia(), [VueQueryPlugin, { queryClient }]] } })
  );
  const panel = required(host.firstElementChild, '面板');
  const scroller = required(host.querySelector<HTMLElement>('[aria-label="消息列表"]'), '消息列表');
  return { host, panel, scroller };
}

describe('MessagePanel 的布局', () => {
  it('不超过给定的最高，只有列表滚动；滚到底接着显示下一批', async () => {
    const { panel, scroller } = mountPanel({ count: 47, width: 400 });
    expect(panel.getBoundingClientRect().height).toBe(480);
    const header = required(panel.querySelector('header'), '标题栏');
    const filters = required(panel.querySelector('.el-radio-group'), '筛选');
    const headerTop = header.getBoundingClientRect().top;
    const filtersTop = filters.getBoundingClientRect().top;
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);

    scroller.scrollTop = scroller.scrollHeight;
    await expect.poll(() => scroller.querySelectorAll('article').length).toBe(MESSAGE_BATCH * 2);
    expect(header.getBoundingClientRect().top).toBe(headerTop);
    expect(filters.getBoundingClientRect().top).toBe(filtersTop);
  });

  it('消息少时按内容定高', () => {
    const { panel } = mountPanel({ count: 2, width: 400 });
    expect(panel.getBoundingClientRect().height).toBeLessThan(480);
  });

  it('窄屏：筛选在一行，长标题省略、时间完整，长正文换行，没有横向滚动', () => {
    const { host, scroller } = mountPanel({ count: 3, width: 343 });
    const radios = required(host.querySelector('.el-radio-group'), '已读筛选').getBoundingClientRect();
    const select = required(host.querySelector('.el-select'), '类型筛选').getBoundingClientRect();
    expect(Math.abs(radios.top + radios.height / 2 - (select.top + select.height / 2))).toBeLessThan(1);
    expect(select.right).toBeLessThanOrEqual(host.getBoundingClientRect().right);

    const first = required(scroller.querySelector('article'), '第一条消息');
    const title = required(first.querySelector('strong'), '标题');
    const time = required(first.querySelector('time'), '时间');
    expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
    expect(time.scrollWidth).toBeLessThanOrEqual(time.clientWidth);
    expect(time.getBoundingClientRect().height).toBeLessThan(20);
    expect(scroller.scrollWidth).toBe(scroller.clientWidth);
  });
});
