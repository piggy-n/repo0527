import { flushPromises, mount } from '@vue/test-utils';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent, type PropType } from 'vue';
import { required } from '@/shared/testing/required';
import { type Composition, emptyComposition, sampleComposition } from '../compose/composition';
import { PROMPT_EXAMPLES } from '../compose/prompt';
import { type CompositionOwner, useComposition } from '../composables/useComposition';
import { usePromptComposer } from '../composables/usePromptComposer';
import type { SimulationModel } from '../composables/useSimulationModel';
import { type Calculator, createCalculator } from '../model/calculator';
import { loadTestAtlas } from '../model/test-atlas';
import { AiDock } from './AiDock';
import { ComposeStage } from './ComposeStage';

let calculator: Calculator;
beforeAll(async () => {
  calculator = createCalculator(await loadTestAtlas());
});
const ready = (): SimulationModel => ({ status: 'ready', calculator });

// 和页面一样：底部是对话栏，编排完成后开始计算
function mountStage(initial: Composition = sampleComposition(), model: SimulationModel = ready()) {
  let owner: CompositionOwner | undefined;
  const Host = defineComponent({
    props: { model: { type: Object as PropType<SimulationModel>, required: true } },
    emits: { start: () => true },
    setup(props, { emit }) {
      const composition = useComposition(initial);
      owner = composition;
      const composer = usePromptComposer(composition, { onComposed: () => emit('start') });
      return () => (
        <div>
          <ComposeStage composition={composition} composer={composer} model={props.model} onStart={() => emit('start')} />
          <AiDock composer={composer} />
        </div>
      );
    }
  });
  const wrapper = mount(Host, { props: { model }, attachTo: document.body });
  return { composition: required(owner, '编排的拥有者'), wrapper };
}

type Wrapper = ReturnType<typeof mountStage>['wrapper'];

const chip = (wrapper: Wrapper, text: string) =>
  required(
    wrapper.findAll('button[aria-pressed]').find(button => button.text() === text),
    `条件库里的"${text}"`
  );
const buttonOf = (wrapper: Wrapper, text: string) =>
  required(
    wrapper.findAll('button').find(button => button.text() === text),
    `"${text}"按钮`
  );
const nodes = (wrapper: Wrapper, prefix?: string) =>
  wrapper.findAll(prefix ? `[data-node^="${prefix}"]` : '[data-node]').map(node => node.attributes('data-node'));

afterEach(() => {
  vi.useRealTimers();
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
    expect(buttonOf(empty.wrapper, '开始计算').attributes('disabled')).toBeDefined();
    expect(empty.wrapper.get('[data-node="output"]').text()).toContain('还缺：年份、监测范围、监测指标');

    const loading = mountStage(sampleComposition(), { status: 'loading' });
    expect(buttonOf(loading.wrapper, '开始计算').attributes('disabled')).toBeDefined();
    expect(loading.wrapper.get('[data-node="output"]').text()).toContain('区县数据加载中');

    const { wrapper } = mountStage();
    await buttonOf(wrapper, '开始计算').trigger('click');
    expect(wrapper.emitted('start')).toHaveLength(1);
  });

  it('参数节点只有所选指标用得上的几项，显示当前取值；点开编辑浮层，草稿在下方的预估里预览', async () => {
    const { wrapper } = mountStage();
    expect(nodes(wrapper, 'params:')).toEqual(['params:popChange', 'params:rule', 'params:recognition', 'params:targets']);
    const node = wrapper.get('[data-node="params:rule"]');
    expect(node.text()).toContain('新规程');
    expect(node.attributes('aria-expanded')).toBe('false');

    await node.trigger('click');
    await flushPromises();
    expect(node.attributes('aria-expanded')).toBe('true');
    const dialog = required(document.body.querySelector('[role="dialog"][aria-label="计算规程"]'), '计算规程的浮层');
    const old = required(dialog.querySelector<HTMLInputElement>('input[value="old"]'), '旧规程的选项');
    old.checked = true;
    old.dispatchEvent(new Event('change'));
    await flushPromises();
    expect(wrapper.get('[aria-label="指标预估结果"]').text()).toContain('参数预览中');
  });

  it('重置条件在条件库的标题栏：点了只剩 AI计算', async () => {
    const { wrapper } = mountStage();
    const reset = buttonOf(wrapper, '重置条件');
    expect(reset.element.closest('section')?.querySelector('h2')?.textContent).toBe('指标计算条件');
    await reset.trigger('click');
    expect(nodes(wrapper)).toEqual(['output']);
  });

  it('指标节点只写名称和单位，下面是灰色的编号；自定义口径的指标多一个标记', async () => {
    const { wrapper, composition } = mountStage();
    const node = () => wrapper.get('[data-node="indicators:A-31"]');

    expect(node().get('b').text()).toBe('社区卫生服务设施步行15分钟覆盖率（%）');
    expect(node().get('[class*="_indicatorMeta_"]').text()).toBe('A-31');
    composition.setParams({ ...composition.state.value.params, rule: 'old' });
    await flushPromises();
    expect(node().get('[class*="_indicatorMeta_"]').text()).toBe('A-31自定义口径');
  });

  it('选了几个年度时预估可以换年度，几个市时写达标的市数', async () => {
    const { wrapper } = mountStage({ ...sampleComposition(), conditions: { ...sampleComposition().conditions, years: [2025, 2026] } });
    const bar = () => wrapper.get('[aria-label="指标预估结果"]');
    expect(bar().get('[aria-label="预估的年度"] input[value="2026"]').element).toHaveProperty('checked', true);
    expect(bar().text()).toContain('预估达标');
    expect(bar().text()).toMatch(/\d+\/13 市/);

    await bar().get('[aria-label="预估的年度"] input[value="2025"]').setValue(true);
    expect(bar().get('[aria-label="预估的年度"] input[value="2025"]').element).toHaveProperty('checked', true);
  });
});

describe('ComposeStage 按 AI计算指令编排', () => {
  // jsdom 没有 scrollBy：编排时会把最新出现的节点滚到看得见
  beforeAll(() => {
    Element.prototype.scrollBy = () => undefined;
  });
  afterAll(() => {
    Reflect.deleteProperty(Element.prototype, 'scrollBy');
  });

  it('输入框空着时占位是示例，Tab 填进来；有字时 Tab 照常移动焦点', async () => {
    const { wrapper } = mountStage(emptyComposition());
    const input = wrapper.get<HTMLTextAreaElement>('[aria-label="计算指令"]');
    expect(input.element.value).toBe('');
    expect(input.attributes('placeholder')).toBe(PROMPT_EXAMPLES[0]);

    await input.trigger('keydown', { key: 'Tab' });
    expect(input.element.value).toBe(PROMPT_EXAMPLES[0]);

    await input.setValue('自己写的');
    await input.trigger('keydown', { key: 'Tab' });
    expect(input.element.value).toBe('自己写的');

    await buttonOf(wrapper, '换一批').trigger('click');
    expect(input.element.value).toBe('');
    expect(input.attributes('placeholder')).not.toBe(PROMPT_EXAMPLES[0]);
  });

  it('发送后编排图从空白开始，一个节点一个节点地出现；期间条件库和编排图不接收操作；完成后开始计算', async () => {
    vi.useFakeTimers();
    const { wrapper } = mountStage(emptyComposition());
    await wrapper.get('[aria-label="计算指令"]').trigger('keydown', { key: 'Tab' });

    await buttonOf(wrapper, '发送').trigger('click');
    expect(buttonOf(wrapper, '配置中').exists()).toBe(true);
    expect(wrapper.get('[role="status"]').text()).toBe('AI 正在理解指令…');
    expect(nodes(wrapper)).toEqual([]);
    // 编排期间不显示"拖入或点选"的占位
    expect(wrapper.text()).not.toContain('拖入或点选');
    const locked = wrapper.findAll('[class*="_locked_"]');
    expect(locked).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(900);
    expect(nodes(wrapper)).toEqual(['years:2025']);
    expect(wrapper.get('[role="status"]').text()).toBe('识别年份：2025 年');
    await vi.advanceTimersByTimeAsync(450 * 2);
    expect(nodes(wrapper)).toEqual(['years:2025', 'region', 'indicators:A-31']);

    // 参数 3 项（人均类的人口变化用不上），再到 AI计算
    await vi.advanceTimersByTimeAsync(450 * 4);
    expect(nodes(wrapper, 'params:')).toEqual(['params:rule', 'params:recognition', 'params:targets']);
    expect(wrapper.get('[role="status"]').text()).toBe('配置完成，即将开始计算');
    expect(buttonOf(wrapper, '计算启动中').exists()).toBe(true);
    expect(wrapper.emitted('start')).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.emitted('start')).toHaveLength(1);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.findAll('[class*="_locked_"]')).toHaveLength(0);
  });
});
