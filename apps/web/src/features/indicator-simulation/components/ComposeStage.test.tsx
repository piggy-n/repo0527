import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { required } from '@/shared/testing/required';
import { type Composition, defaultComposition, emptyComposition } from '../compose/composition';
import { useComposition } from '../composables/useComposition';
import type { SimulationModel } from '../composables/useSimulationModel';
import type { Calculator } from '../model/calculator';
import { ComposeStage } from './ComposeStage';

// 这些用例不做预估，用不到计算
const ready: SimulationModel = { status: 'ready', calculator: {} as Calculator };

function mountStage(initial: Composition = defaultComposition(), model: SimulationModel = ready) {
  const composition = useComposition(initial);
  const wrapper = mount(ComposeStage, { props: { composition, model }, attachTo: document.body });
  return { composition, wrapper };
}

const chip = (wrapper: ReturnType<typeof mountStage>['wrapper'], text: string) =>
  required(
    wrapper.findAll('button[aria-pressed]').find(button => button.text() === text),
    `条件库里的"${text}"`
  );

const nodes = (wrapper: ReturnType<typeof mountStage>['wrapper'], prefix: string) =>
  wrapper.findAll(`[data-node^="${prefix}"]`).map(node => node.attributes('data-node'));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ComposeStage', () => {
  it('点选条件库加上节点，再点一次或点节点上的叉去掉', async () => {
    const { wrapper } = mountStage(emptyComposition());
    await chip(wrapper, '2024').trigger('click');
    await chip(wrapper, '2022').trigger('click');
    expect(nodes(wrapper, 'years:')).toEqual(['years:2024', 'years:2022']);
    expect(chip(wrapper, '2024').attributes('aria-pressed')).toBe('true');

    await wrapper.get('[aria-label="移除2024 年"]').trigger('click');
    await chip(wrapper, '2022').trigger('click');
    expect(nodes(wrapper, 'years:')).toEqual([]);
    expect(wrapper.text()).toContain('拖入或点选年份');
  });

  it('从条件库拖到编排图：没有的加上，已有的节点闪一下', async () => {
    const { wrapper, composition } = mountStage();
    await chip(wrapper, '停车场覆盖率').trigger('dragstart');
    expect(wrapper.find('[data-drop="indicators"]').exists()).toBe(true);
    await wrapper.get('[data-lane="indicators"]').trigger('drop');
    expect(composition.state.value.conditions.indicatorIds.at(-1)).toBe('A08-1');
    expect(wrapper.find('[data-drop]').exists()).toBe(false);

    await chip(wrapper, '2026').trigger('dragstart');
    await wrapper.get('[data-lane="output"]').trigger('drop');
    expect(nodes(wrapper, 'years:')).toEqual(['years:2026']);
    expect(wrapper.get('[data-node="years:2026"]').classes().join(' ')).toMatch(/flash/);
  });

  it('不是从条件库开始的拖动（如指标排序）不高亮、不当作放入', async () => {
    const { wrapper, composition } = mountStage();
    const before = composition.state.value;
    const canvas = () => required(wrapper.get('[data-lane="years"]').element.closest('[class*="_canvas_"]'), '画布');
    await wrapper.get('[data-lane="years"]').trigger('dragover');
    expect(canvas().className).not.toMatch(/_over_/);
    await wrapper.get('[data-lane="years"]').trigger('drop');
    expect(composition.state.value).toBe(before);

    await chip(wrapper, '2024').trigger('dragstart');
    await wrapper.get('[data-lane="years"]').trigger('dragover');
    expect(canvas().className).toMatch(/_over_/);
  });

  it('指标的手柄按上下方向键调整顺序，焦点留在手柄上', async () => {
    const { wrapper } = mountStage();
    const handle = wrapper.get('[data-indicator-handle="B-65"]');
    (handle.element as HTMLElement).focus();
    await handle.trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    expect(nodes(wrapper, 'indicators:')).toEqual(['indicators:A-31', 'indicators:B-65', 'indicators:A-39']);
    expect(document.activeElement?.getAttribute('data-indicator-handle')).toBe('B-65');

    await wrapper.get('[data-indicator-handle="A-31"]').trigger('keydown', { key: 'ArrowUp' });
    expect(nodes(wrapper, 'indicators:')).toEqual(['indicators:A-31', 'indicators:B-65', 'indicators:A-39']);
  });

  it('全省复选框全选、清空；部分选中时是半选', async () => {
    const { wrapper, composition } = mountStage();
    await chip(wrapper, '南京').trigger('click');
    expect(wrapper.find('.el-checkbox .is-indeterminate').exists()).toBe(true);
    expect(wrapper.get('[data-node="region"]').text()).toContain('12 个市');

    await wrapper.get('.el-checkbox input').setValue(true);
    expect(composition.state.value.conditions.cityCodes).toHaveLength(13);
    expect(wrapper.get('[data-node="region"]').text()).toContain('全省');
  });

  it('条件不全或区县数据没加载好时不能开始；齐全后开始', async () => {
    const empty = mountStage(emptyComposition());
    const start = (wrapper: typeof empty.wrapper) =>
      required(
        wrapper.findAll('button').find(button => button.text() === '开始推演'),
        '开始推演按钮'
      );
    expect(start(empty.wrapper).attributes('disabled')).toBeDefined();
    expect(empty.wrapper.get('[data-node="output"]').text()).toContain('还缺：年份、监测范围、监测指标');

    const loading = mountStage(defaultComposition(), { status: 'loading' });
    expect(start(loading.wrapper).attributes('disabled')).toBeDefined();
    expect(loading.wrapper.get('[data-node="output"]').text()).toContain('区县数据加载中');

    const { wrapper } = mountStage();
    await start(wrapper).trigger('click');
    expect(wrapper.emitted('start')).toHaveLength(1);
  });

  it('参数节点显示当前取值，点开编辑浮层', async () => {
    // 浮层里的预估要计算，区县数据加载中时只显示提示
    const { wrapper } = mountStage(defaultComposition(), { status: 'loading' });
    const node = wrapper.get('[data-node="params:walkSpeed"]');
    expect(node.text()).toContain('60 米/分钟');
    expect(node.attributes('aria-expanded')).toBe('false');

    await node.trigger('click');
    await flushPromises();
    expect(node.attributes('aria-expanded')).toBe('true');
    const dialog = required(document.body.querySelector('[role="dialog"][aria-label="步行速度"]'), '步行速度的浮层');
    expect(dialog.textContent).toContain('区县数据加载中');
  });

  it('清空在条件库的标题栏：点了只剩 AI 推演', async () => {
    const { wrapper } = mountStage();
    const clear = required(
      wrapper.findAll('button').find(button => button.text() === '清空'),
      '清空按钮'
    );
    expect(clear.element.closest('section')?.querySelector('h2')?.textContent).toBe('条件库');
    await clear.trigger('click');
    expect(wrapper.findAll('[data-node]').map(node => node.attributes('data-node'))).toEqual(['output']);
  });

  it('指标节点：名称后面括号写单位，下面只有灰色的编号', () => {
    const { wrapper } = mountStage();
    const node = wrapper.get('[data-node="indicators:A-39"]');

    expect(node.get('b').text()).toBe('人均公园绿地面积（m²）');
    expect(node.get('[class*="_meta_"]').text()).toBe('A-39');
  });
});
