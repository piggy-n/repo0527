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
