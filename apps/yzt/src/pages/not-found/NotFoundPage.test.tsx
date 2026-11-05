import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { RouteName } from '@/shared/router/route-names';
import { NotFoundPage } from './NotFoundPage';

const EmptyPage = defineComponent(() => () => null);

describe('NotFoundPage', () => {
  it('点击"返回首页"跳转到首页', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: RouteName.home, component: EmptyPage },
        { path: '/:pathMatch(.*)*', component: NotFoundPage }
      ]
    });
    await router.push('/no/such/page');
    const wrapper = mount(NotFoundPage, { global: { plugins: [router] } });

    await wrapper.find('button').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe(RouteName.home);
  });
});
