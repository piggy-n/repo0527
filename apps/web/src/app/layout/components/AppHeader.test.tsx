import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createMessageBackend } from '@/features/message-center/test-data';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { routesWithoutPages } from '../../router/test-routes';
import { AppHeader } from './AppHeader';
import { HeaderMessages } from './HeaderMessages';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('AppHeader', () => {
  it('消息按钮在用户菜单左边，弹框按整个顶栏定位', async () => {
    server.use(...createMessageBackend().handlers);
    const pinia = createPinia();
    setActivePinia(pinia);
    useSessionStore().start({
      token: createTestJwtExpiringAt(Date.now() + 3600000),
      user: { loginName: 'admin', role: Role.admin }
    });
    const router = createRouter({ history: createMemoryHistory(), routes: routesWithoutPages() });
    await router.push('/current-map');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = mount(AppHeader, { global: { plugins: [pinia, router, [VueQueryPlugin, { queryClient }]] } });

    const user = wrapper.get('[class*="_user_"]');
    expect([...user.element.children].map(child => child.textContent?.trim())).toEqual(['', 'admin']);
    expect(user.element.firstElementChild?.getAttribute('aria-label')).toMatch(/^消息/);
    // 顶栏的元素挂载以后才有，再渲染一次才交给消息按钮
    await vi.waitFor(() => expect(wrapper.findComponent(HeaderMessages).props('header')).toBe(wrapper.element));
  });
});
