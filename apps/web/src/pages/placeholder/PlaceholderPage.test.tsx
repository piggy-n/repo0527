import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { PlaceholderPage } from './PlaceholderPage';

// 只注册用例需要的路由，不导入 app 的路由表（pages 不能依赖 app）
async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/with-title', component: PlaceholderPage, meta: { title: '现状底图' } },
      { path: '/without-title', component: PlaceholderPage }
    ]
  });
  await router.push(path);
  return mount(PlaceholderPage, { global: { plugins: [router] } });
}

describe('PlaceholderPage', () => {
  it('显示路由标题', async () => {
    const wrapper = await mountAt('/with-title');

    expect(wrapper.text()).toContain('现状底图：迁移中');
  });

  it('没有标题时显示路径', async () => {
    const wrapper = await mountAt('/without-title');

    expect(wrapper.text()).toContain('/without-title：迁移中');
  });
});
