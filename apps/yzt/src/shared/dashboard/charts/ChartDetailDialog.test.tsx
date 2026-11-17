import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { required } from '../../testing/required';
import { DASHBOARD_CITIES } from '../cities';
import { ChartDetailDialog } from './ChartDetailDialog';

afterEach(() => {
  // 弹窗渲染在 body 下，不归组件管
  document.body.innerHTML = '';
});

function dialog() {
  return required(document.querySelector('.el-dialog'), '详情弹窗');
}

describe('ChartDetailDialog', () => {
  it('标题、说明、操作照调用方给出；没有配置时显示空态，关闭由调用方处理', async () => {
    const wrapper = mount(ChartDetailDialog, {
      props: {
        visible: true,
        title: '教育便利性指数',
        description: '教育便利性指数详情',
        focusText: '南京市 · 当前查看城市',
        option: () => null,
        cities: DASHBOARD_CITIES
      },
      slots: { actions: () => <button type="button">操作</button> }
    });
    await nextTick();
    const element = dialog();
    expect(element.querySelector('.el-dialog__body h2')?.textContent).toBe('教育便利性指数');
    expect(element.textContent).toContain('南京市 · 当前查看城市');
    expect(element.textContent).toContain('操作');
    expect(element.textContent).toContain('暂无比较数据');
    const close = [...element.querySelectorAll('button')].find(button => button.textContent === '关闭');
    required(close, '关闭按钮').click();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('提示插槽没有内容时不留外框，有内容时才包上提示的位置', async () => {
    const hovered = ref(false);
    mount(ChartDetailDialog, {
      props: {
        visible: true,
        title: '标题',
        description: '说明',
        option: () => null,
        cities: DASHBOARD_CITIES,
        emptyText: '雷达图至少需要 3 个城市'
      },
      slots: { tooltip: () => hovered.value && <p>提示表格</p> }
    });
    await nextTick();
    expect(dialog().textContent).toContain('雷达图至少需要 3 个城市');
    // 标题下面只有操作行和图表区
    const blocks = () => [...dialog().querySelectorAll('.el-dialog__body h2 ~ div')];
    expect(blocks()).toHaveLength(2);
    hovered.value = true;
    await nextTick();
    expect(blocks()).toHaveLength(3);
    expect(blocks()[2].textContent).toBe('提示表格');
  });

  it('关着的弹窗不取图表配置，打开后才取', async () => {
    const option = vi.fn<() => null>(() => null);
    const wrapper = mount(ChartDetailDialog, {
      props: { visible: false, title: '标题', description: '说明', option, cities: DASHBOARD_CITIES }
    });
    await nextTick();
    expect(option).not.toHaveBeenCalled();
    await wrapper.setProps({ visible: true });
    await nextTick();
    expect(option).toHaveBeenCalled();
    expect(dialog().textContent).toContain('暂无比较数据');
  });
});
