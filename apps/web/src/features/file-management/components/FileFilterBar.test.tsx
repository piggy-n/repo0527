import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import type { FileFilters } from '../composables/useFileList';
import { FileFilterBar } from './FileFilterBar';

afterEach(() => {
  document.body.innerHTML = '';
});

function mountBar() {
  const model = reactive<FileFilters>({ name: '', year: '', tag: '' });
  return mount(FileFilterBar, { props: { model }, attachTo: document.body });
}

const button = (wrapper: ReturnType<typeof mountBar>, text: string) =>
  wrapper.findAll('button').filter(item => item.text() === text);

describe('FileFilterBar', () => {
  // 包住时，点清除图标后浏览器会把点击转给里面的输入框，下拉框随之展开；jsdom 不做这次转发，只能检查结构
  it('标签不包住控件', async () => {
    const wrapper = mountBar();
    // 控件挂载后登记了 id，ElFormItem 才把标签渲染成带 for 的 label
    await flushPromises();

    const labels = wrapper.findAll('label');
    expect(labels.map(label => label.text())).toEqual(['文档名称', '年份', '业务类型标签']);
    expect(labels.filter(label => label.find('input').exists())).toHaveLength(0);
  });

  it('在名称框按回车、点"查询"都触发查询', async () => {
    const wrapper = mountBar();

    await wrapper.find('input[placeholder="请输入文档名称"]').trigger('keydown', { key: 'Enter' });
    await button(wrapper, '查询')[0]?.trigger('click');

    expect(wrapper.emitted('search')).toHaveLength(2);
  });

  it('点"重置"触发重置', async () => {
    const wrapper = mountBar();

    await button(wrapper, '重置')[0]?.trigger('click');

    expect(wrapper.emitted('reset')).toHaveLength(1);
    expect(wrapper.emitted('search')).toBeUndefined();
  });
});
