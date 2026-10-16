import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, onUnmounted } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { AppLayout } from './AppLayout';

// 记下每个页面创建、卸载了几次
function trackedPage(name: string, counts: Record<string, { created: number; unmounted: number }>) {
  return defineComponent({
    name,
    setup() {
      const count = (counts[name] ??= { created: 0, unmounted: 0 });
      count.created++;
      onUnmounted(() => count.unmounted++);
      return () => <div data-page={name} />;
    }
  });
}

async function setup() {
  const counts: Record<string, { created: number; unmounted: number }> = {};
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: trackedPage('Login', counts) },
      {
        path: '/',
        component: AppLayout,
        children: [
          { path: 'map', component: trackedPage('Map', counts), meta: { keepAlive: true } },
          { path: 'files', component: trackedPage('Files', counts) }
        ]
      }
    ]
  });
  await router.push('/map');
  // 顶部栏要会话和导航，这里只看内容区
  const wrapper = mount(defineComponent(() => () => <RouterView />), {
    global: { plugins: [router], stubs: { AppHeader: true } }
  });
  await router.isReady();
  return { router, counts, wrapper };
}

describe('AppLayout 的页面缓存', () => {
  it('meta 写了 keepAlive 的页面切走再回来仍是同一个实例；其他页面每次重新创建', async () => {
    const { router, counts, wrapper } = await setup();

    await router.push('/files');
    await router.push('/map');
    await router.push('/files');

    expect(counts.Map).toStrictEqual({ created: 1, unmounted: 0 });
    expect(counts.Files).toStrictEqual({ created: 2, unmounted: 1 });
    expect(wrapper.find('[data-page="Files"]').exists()).toBe(true);
    // 缓存的页面不在文档里
    expect(wrapper.find('[data-page="Map"]').exists()).toBe(false);
  });

  it('离开布局时缓存跟着清空：再回来是新的页面', async () => {
    const { router, counts } = await setup();
    await router.push('/files');

    await router.push('/login');
    expect(counts.Map).toStrictEqual({ created: 1, unmounted: 1 });
    await router.push('/map');

    expect(counts.Map).toStrictEqual({ created: 2, unmounted: 1 });
  });
});
