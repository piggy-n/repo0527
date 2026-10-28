import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { TableSkeleton } from '@/shared/table/TableSkeleton';
import { SystemFilters } from './SystemFilters';
import { SystemTable } from './SystemTable';

afterEach(() => vi.useRealTimers());

describe('系统管理列表交互', () => {
  it('首次请求等待骨架时留空，不闪现无数据提示；结束后显示真正空状态', async () => {
    vi.useFakeTimers();
    const wrapper = mount(SystemTable, {
      props: {
        section: 'audit',
        rows: [],
        offset: 0,
        initialLoading: true,
        isDownloading: () => false
      }
    });
    await nextTick();
    expect(wrapper.text()).not.toContain('暂无');
    await vi.advanceTimersByTimeAsync(300);
    expect(wrapper.findComponent(TableSkeleton).exists()).toBe(true);
    await wrapper.setProps({ initialLoading: false });
    expect(wrapper.text()).toContain('暂无符合条件的数据');
  });

  it('输入法选字的回车不触发查询，普通回车才查询', async () => {
    const wrapper = mount(SystemFilters, {
      props: {
        audit: true,
        form: { name: '', status: 'all', taskStatus: 'all' }
      }
    });
    const input = wrapper.get('input[placeholder="请输入数据名称"]');
    await input.trigger('keydown', { key: 'Enter', isComposing: true });
    expect(wrapper.emitted('search')).toBeUndefined();
    await input.trigger('keydown', { key: 'Enter', isComposing: false });
    expect(wrapper.emitted('search')).toHaveLength(1);
  });
});
