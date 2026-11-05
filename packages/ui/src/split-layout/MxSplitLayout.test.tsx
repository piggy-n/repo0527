import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, onMounted, ref } from 'vue';
import { MxPanel } from '../panel/MxPanel';
import { useSplitLayout } from './context';
import { MxSplitLayout } from './MxSplitLayout';

type ChangeListener = (event: { matches: boolean }) => void;

// jsdom 没有 matchMedia；模拟一个可以切换窄屏、并通知监听者的版本
function stubViewport(compact: boolean) {
  let matches = compact;
  const listeners = new Set<ChangeListener>();
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    get matches() {
      return matches;
    },
    addEventListener: (_type: string, listener: ChangeListener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: ChangeListener) => listeners.delete(listener)
  }));
  return async (value: boolean) => {
    matches = value;
    listeners.forEach(listener => listener({ matches: value }));
    await flushPromises();
  };
}

// 侧栏里有内部状态的组件：记录挂载次数，检查移动时是否被重建
let mounts = 0;
const Counter = defineComponent({
  setup() {
    const count = ref(0);
    const { closeAside } = useSplitLayout();
    onMounted(() => {
      mounts += 1;
    });
    return () => (
      <div data-test="counter">
        <button type="button" data-test="increase" onClick={() => (count.value += 1)}>
          {count.value}
        </button>
        <button type="button" data-test="select" onClick={closeAside}>
          选中后关闭
        </button>
      </div>
    );
  }
});

function mountLayout(asideType?: 'menu' | 'panel') {
  return mount(
    () => (
      <MxSplitLayout asideType={asideType} asideLabel="文件目录">
        {{
          aside: () => (
            <MxPanel title="文件目录">
              <Counter />
              <MxPanel title="嵌套面板">内容</MxPanel>
            </MxPanel>
          ),
          default: () => (
            <MxPanel title="文件列表">表格</MxPanel>
          )
        }}
      </MxSplitLayout>
    ),
    { attachTo: document.body }
  );
}

// 页面给出的把手：只放一个标记，像设计图一样没有文字
const handleSlots = {
  rail: () => <span data-test="rail-art" />,
  collapse: () => <span data-test="collapse-art" />
};

// 页面持有收起状态：像页面一样按布局发出的事件改；handles 时用页面给出的把手
function mountCollapsible(initial: boolean, handles = false) {
  const collapsed = ref(initial);
  const wrapper = mount(
    () => (
      <MxSplitLayout
        asideLabel="文件目录"
        collapsible
        collapsed={collapsed.value}
        onUpdate:collapsed={value => (collapsed.value = value)}
      >
        {{
          ...(handles ? handleSlots : {}),
          aside: () => (
            <MxPanel title="文件目录">
              <Counter />
              <MxPanel title="嵌套面板">内容</MxPanel>
            </MxPanel>
          ),
          default: () => <MxPanel title="文件列表">表格</MxPanel>
        }}
      </MxSplitLayout>
    ),
    { attachTo: document.body }
  );
  return { wrapper, collapsed };
}

const collapseButtons = (wrapper: ReturnType<typeof mountLayout>) => wrapper.findAll('button[aria-label="收起文件目录"]');

const counterPlace = (wrapper: ReturnType<typeof mountLayout>) => {
  const counter = wrapper.find('[data-test="counter"]').element;
  return counter.closest('.el-drawer') ? 'drawer' : counter.closest('aside') ? 'aside' : 'other';
};
const toggleButtons = (wrapper: ReturnType<typeof mountLayout>) =>
  wrapper.findAll('button').filter(button => button.text() === '文件目录');
const closeButtons = (wrapper: ReturnType<typeof mountLayout>) => wrapper.findAll('button[aria-label="关闭文件目录"]');

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  mounts = 0;
});

describe('MxSplitLayout', () => {
  it('宽屏：侧栏内容在侧栏中，没有打开和关闭按钮', async () => {
    stubViewport(false);
    const wrapper = mountLayout();
    await flushPromises();

    expect(counterPlace(wrapper)).toBe('aside');
    expect(wrapper.find('aside').attributes('style')).toContain('width: 320px');
    expect(toggleButtons(wrapper)).toHaveLength(0);
    expect(closeButtons(wrapper)).toHaveLength(0);
  });

  it('宽屏可收起：只有侧栏最外层的面板有收起按钮，收起后侧栏隐藏、换成窄条，点窄条在原位展开、状态保留', async () => {
    stubViewport(false);
    const { wrapper, collapsed } = mountCollapsible(false);
    await flushPromises();
    await wrapper.find('[data-test="increase"]').trigger('click');

    expect(collapseButtons(wrapper)).toHaveLength(1);
    expect(toggleButtons(wrapper)).toHaveLength(0);
    await collapseButtons(wrapper)[0]?.trigger('click');
    await flushPromises();

    expect(collapsed.value).toBe(true);
    expect(wrapper.find('aside').classes().some(name => name.includes('hidden'))).toBe(true);
    expect(toggleButtons(wrapper)).toHaveLength(1);
    expect(toggleButtons(wrapper)[0]?.attributes('aria-expanded')).toBe('false');
    await toggleButtons(wrapper)[0]?.trigger('click');
    await flushPromises();

    expect(collapsed.value).toBe(false);
    expect(counterPlace(wrapper)).toBe('aside');
    expect(wrapper.find('[data-test="increase"]').text()).toBe('1');
    expect(mounts).toBe(1);
  });

  it('没开启 collapsible 时宽屏没有收起按钮，collapsed 不起作用', async () => {
    stubViewport(false);
    const wrapper = mount(() => (
      <MxSplitLayout asideLabel="文件目录" collapsed>
        {{ aside: () => <MxPanel title="文件目录">目录</MxPanel>, default: () => <MxPanel title="文件列表">表格</MxPanel> }}
      </MxSplitLayout>
    ));
    await flushPromises();

    expect(collapseButtons(wrapper)).toHaveLength(0);
    expect(wrapper.find('aside').classes().some(name => name.includes('hidden'))).toBe(false);
    expect(toggleButtons(wrapper)).toHaveLength(0);
  });

  it('窄屏时照常用抽屉：收起的状态不影响，抽屉里只有关闭按钮', async () => {
    stubViewport(true);
    const { wrapper, collapsed } = mountCollapsible(true);
    await flushPromises();
    await toggleButtons(wrapper)[0]?.trigger('click');
    await flushPromises();

    expect(collapsed.value).toBe(true);
    expect(counterPlace(wrapper)).toBe('drawer');
    expect(collapseButtons(wrapper)).toHaveLength(0);
    expect(closeButtons(wrapper)).toHaveLength(1);
  });

  it('页面给出把手：收起把手在侧栏上、面板里没有收起按钮；收起后窄条是页面的内容，名称由 aria-label 给出，点击在原位展开', async () => {
    stubViewport(false);
    const { wrapper, collapsed } = mountCollapsible(false, true);
    await flushPromises();
    await wrapper.find('[data-test="increase"]').trigger('click');

    const [handle] = collapseButtons(wrapper);
    expect(collapseButtons(wrapper)).toHaveLength(1);
    expect(handle?.find('[data-test="collapse-art"]').exists()).toBe(true);
    expect(handle?.element.parentElement?.tagName).toBe('ASIDE');
    await handle?.trigger('click');
    await flushPromises();

    const rail = wrapper.find('button[aria-expanded]');
    expect(collapsed.value).toBe(true);
    expect(collapseButtons(wrapper)).toHaveLength(0);
    expect(rail.attributes('aria-label')).toBe('文件目录');
    expect(rail.attributes('aria-expanded')).toBe('false');
    expect(rail.find('[data-test="rail-art"]').exists()).toBe(true);
    expect(rail.text()).toBe('');
    await rail.trigger('click');
    await flushPromises();

    expect(collapsed.value).toBe(false);
    expect(counterPlace(wrapper)).toBe('aside');
    expect(wrapper.find('[data-test="increase"]').text()).toBe('1');
  });

  it('页面给出把手时窄屏不用它们：默认的窄条打开抽屉，抽屉里只有关闭按钮', async () => {
    stubViewport(true);
    // 页面的状态是展开，窄屏时不起作用
    const { wrapper } = mountCollapsible(false, true);
    await flushPromises();

    expect(wrapper.find('[data-test="rail-art"]').exists()).toBe(false);
    expect(toggleButtons(wrapper)).toHaveLength(1);
    expect(toggleButtons(wrapper)[0]?.attributes('aria-label')).toBeUndefined();
    await toggleButtons(wrapper)[0]?.trigger('click');
    await flushPromises();

    expect(counterPlace(wrapper)).toBe('drawer');
    expect(wrapper.find('[data-test="collapse-art"]').exists()).toBe(false);
    expect(collapseButtons(wrapper)).toHaveLength(0);
    expect(closeButtons(wrapper)).toHaveLength(1);
  });

  it('菜单型侧栏宽 200', async () => {
    stubViewport(false);
    const wrapper = mountLayout('menu');
    await flushPromises();

    expect(wrapper.find('aside').attributes('style')).toContain('width: 200px');
  });

  it('窄屏：侧栏收成窄条，点击后侧栏内容移进抽屉，组件不重建、状态保留', async () => {
    stubViewport(true);
    const wrapper = mountLayout();
    await flushPromises();
    await wrapper.find('[data-test="increase"]').trigger('click');

    expect(toggleButtons(wrapper)).toHaveLength(1);
    // 入口是布局自己的窄条，不在任何面板（包括主区面板的标题行）里
    expect(toggleButtons(wrapper)[0]?.element.closest('section')).toBeNull();
    expect(toggleButtons(wrapper)[0]?.attributes('aria-expanded')).toBe('false');
    await toggleButtons(wrapper)[0]?.trigger('click');
    await flushPromises();

    expect(toggleButtons(wrapper)[0]?.attributes('aria-expanded')).toBe('true');
    expect(counterPlace(wrapper)).toBe('drawer');
    expect(wrapper.find('[data-test="increase"]').text()).toBe('1');
    expect(mounts).toBe(1);
  });

  it('抽屉里只有侧栏最外层的面板有关闭按钮，点击后关闭抽屉', async () => {
    stubViewport(true);
    const wrapper = mountLayout();
    await flushPromises();
    await toggleButtons(wrapper)[0]?.trigger('click');
    await flushPromises();

    expect(closeButtons(wrapper)).toHaveLength(1);
    await closeButtons(wrapper)[0]?.trigger('click');
    await flushPromises();

    expect(wrapper.find('.el-overlay').attributes('style')).toContain('display: none');
  });

  it('侧栏里的组件用 useSplitLayout().closeAside 关闭抽屉', async () => {
    stubViewport(true);
    const wrapper = mountLayout();
    await flushPromises();
    await toggleButtons(wrapper)[0]?.trigger('click');
    await flushPromises();

    await wrapper.find('[data-test="select"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('.el-overlay').attributes('style')).toContain('display: none');
  });

  it('从窄屏回到宽屏：关闭抽屉，内容回到侧栏，状态保留', async () => {
    const setCompact = stubViewport(true);
    const wrapper = mountLayout();
    await flushPromises();
    await toggleButtons(wrapper)[0]?.trigger('click');
    await flushPromises();
    await wrapper.find('[data-test="increase"]').trigger('click');

    await setCompact(false);

    expect(counterPlace(wrapper)).toBe('aside');
    expect(wrapper.find('[data-test="increase"]').text()).toBe('1');
    expect(mounts).toBe(1);
    expect(toggleButtons(wrapper)).toHaveLength(0);
    expect(wrapper.find('.el-overlay').attributes('style')).toContain('display: none');
  });

  it('useSplitLayout 在布局外调用时报错', () => {
    const Outside = defineComponent({
      setup() {
        useSplitLayout();
        return () => null;
      }
    });

    expect(() => mount(Outside)).toThrow('只能在 MxSplitLayout 内部使用');
  });
});
