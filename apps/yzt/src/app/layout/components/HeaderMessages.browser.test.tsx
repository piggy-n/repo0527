import 'element-plus/dist/index.css';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { defineComponent, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { Message } from '@/features/message-center/api';
import { messageKeys } from '@/features/message-center/queries';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { required } from '@/shared/testing/required';
import { routesWithoutPages } from '../../router/test-routes';
import { HeaderMessages } from './HeaderMessages';

// 真实的布局（ADR 0040）：弹框贴着顶栏下沿 8、右边和按钮对齐，窄屏时左右离窗口 16，最高不超出窗口

const HEADER_HEIGHT = 75;

const messages: Message[] = Array.from({ length: 30 }, (_, index) => ({
  id: `msg-${index}`,
  category: 'table',
  title: '报表分析通知',
  content: '基本统计报表_区级',
  createdAt: '2026-10-14 14:28:00',
  read: false,
  applyId: null
}));

const mounted: VueWrapper[] = [];

afterEach(async () => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount());
  document.body.innerHTML = '';
  await page.viewport(1280, 800);
});

// 仿照顶栏：75 高、右边留 20；缓存里先放好数据、不过期，不发请求
async function openAt(width: number, height: number) {
  await page.viewport(width, height);
  document.body.style.margin = '0';
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({
    token: createTestJwtExpiringAt(Date.now() + 3600000),
    user: { loginName: 'admin', role: Role.admin }
  });
  const router = createRouter({ history: createMemoryHistory(), routes: routesWithoutPages() });
  await router.push('/current-map');
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  queryClient.setQueryData(messageKeys.list(), messages);
  queryClient.setQueryData(messageKeys.unread(), messages);
  const Host = defineComponent(() => {
    const header = ref<HTMLElement>();
    return () => (
      <div
        ref={header}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          height: `${HEADER_HEIGHT}px`,
          paddingRight: '20px'
        }}
      >
        <HeaderMessages header={header.value} />
      </div>
    );
  });
  mounted.push(
    mount(Host, {
      attachTo: document.body,
      // 弹框的开关跟着 Element 过渡的钩子，不能用默认的过渡替身
      global: { plugins: [pinia, router, [VueQueryPlugin, { queryClient }]], stubs: { transition: false } }
    })
  );
  const button = required(document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]'), '消息按钮');
  button.click();
  await expect.poll(() => button.getAttribute('aria-expanded')).toBe('true');
  const popper = required(document.querySelector<HTMLElement>('.el-popover'), '弹框');
  // 等 Popper 定位、淡入结束
  await expect.poll(() => getComputedStyle(popper).opacity).toBe('1');
  return { button: button.getBoundingClientRect(), popper: popper.getBoundingClientRect() };
}

describe('HeaderMessages 的弹框位置', () => {
  it('宽屏：顶边离顶栏下沿 8，右边和按钮对齐，宽 400，最高 640', async () => {
    const { button, popper } = await openAt(1280, 800);
    expect(popper.top).toBeCloseTo(HEADER_HEIGHT + 8, 0);
    expect(popper.right).toBeCloseTo(button.right, 0);
    expect(popper.width).toBe(400);
    expect(popper.height).toBe(640);
  });

  it('窄屏：左右离窗口 16；矮屏：底边离窗口 16', async () => {
    const { popper } = await openAt(375, 560);
    expect(popper.left).toBeCloseTo(16, 0);
    expect(popper.right).toBeCloseTo(375 - 16, 0);
    expect(popper.bottom).toBeCloseTo(560 - 16, 0);
  });
});
