import 'element-plus/dist/index.css';
import type { CameraState } from '@yzt/map-core';
import { provideMap } from '@yzt/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { MapPanelGroup } from './MapPanelGroup';
import { type PanelGroup, usePanelGroup } from './usePanelGroup';

// 真实的布局（ADR 0040）：jsdom 里元素的尺寸都是 0，滚动区域的留白和标签换行只能在浏览器里验证

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };
const ORDER = ['region', 'coordinate', 'boundaries', 'legend'] as const;
type Id = (typeof ORDER)[number];
const LABELS = { region: '区划定位', coordinate: '坐标定位', boundaries: '行政区', legend: '图例' };

// 用到的令牌由 app 的样式给出，这里直接写出
const TOKENS = {
  '--space-sm': '8px',
  '--space-md': '12px',
  '--space-lg': '16px',
  '--font-size-base': '14px',
  '--font-size-lg': '16px',
  '--font-weight-semibold': '600',
  '--color-text-strong': '#2F3A4F',
  '--color-text-title': '#1F2937',
  '--color-primary-bg': '#EEF3FF',
  '--color-primary-border': '#C9D4FB',
  '--color-primary': '#597EF7',
  '--color-neutral-bg-light': '#F1F4F8'
};

// 每个功能的内容：20 行
const rows = () => [
  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
    {Array.from({ length: 20 }, (_, index) => (
      <div key={index} style={{ height: '28px', flex: 'none' }} data-row={index} />
    ))}
  </div>
];

// 页面上压缩面板组的纵向 flex 容器，高度放不下内容
function setup(height: number, width = 320) {
  const host = document.body.appendChild(document.createElement('div'));
  let group: PanelGroup<Id> | undefined;
  const wrapper = mount(
    defineComponent(() => {
      provideMap({ groups: [], camera: CAMERA });
      const owned = usePanelGroup(ORDER);
      const collapsed = ref(false);
      group = owned;
      return () => (
        <div style={{ display: 'flex', flexDirection: 'column', width: `${width}px`, height: `${height}px`, ...TOKENS }}>
          <MapPanelGroup
            group={owned}
            labels={LABELS}
            visible
            collapsible
            collapsed={collapsed.value}
            onUpdate:collapsed={value => (collapsed.value = value)}
          >
            {{ region: rows, coordinate: rows, boundaries: rows, legend: rows }}
          </MapPanelGroup>
        </div>
      );
    }),
    { attachTo: host }
  );
  if (!group) {
    throw new Error('页面没有创建面板组');
  }
  return {
    wrapper,
    group,
    [Symbol.dispose]() {
      wrapper.unmount();
      host.remove();
    }
  };
}

// 等若干个动画帧
function frames(count: number): Promise<void> {
  return new Promise(resolve => {
    let left = count;
    const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
}

// 这个功能的 Tab（名称和关闭按钮）是否完整地在 Tab 区的可见范围里
function tabVisible(wrapper: VueWrapper, label: string): boolean {
  const list = wrapper.get('[role="tablist"]').element.getBoundingClientRect();
  const tab = wrapper.findAll('[role="tab"]').find(item => item.text() === label)?.element.parentElement;
  if (!tab) {
    throw new Error(`没有"${label}"这个 Tab`);
  }
  const box = tab.getBoundingClientRect();
  return box.left >= list.left - 0.5 && box.right <= list.right + 0.5
    && box.top >= list.top - 0.5 && box.bottom <= list.bottom + 0.5;
}

describe('MapPanelGroup（真实的布局）', () => {
  it('单功能省去标签区，多功能恢复标签，关闭后释放高度且保留已有内容', async () => {
    using ctx = setup(400);
    ctx.group.show('region');
    await nextTick();

    expect(ctx.wrapper.get('h2').text()).toBe('区划定位');
    expect(ctx.wrapper.find('[role="tablist"]').exists()).toBe(false);
    const content = ctx.wrapper.get('[data-panel="region"]').element;
    const singleTop = content.getBoundingClientRect().top;

    ctx.group.show('coordinate');
    await nextTick();
    expect(ctx.wrapper.get('h2').text()).toBe('地图工具');
    expect(ctx.wrapper.findAll('[role="tab"]')).toHaveLength(2);
    await ctx.wrapper.findAll('[role="tab"]').find(tab => tab.text() === '区划定位')?.trigger('click');
    expect(ctx.wrapper.get('[data-panel="region"]').element).toBe(content);
    expect(content.getBoundingClientRect().top).toBeGreaterThan(singleTop);

    await ctx.wrapper.get('[aria-label="关闭坐标定位"]').trigger('click');
    expect(ctx.wrapper.get('h2').text()).toBe('区划定位');
    expect(ctx.wrapper.find('[role="tablist"]').exists()).toBe(false);
    expect(ctx.wrapper.get('[data-panel="region"]').element).toBe(content);
    expect(content.getBoundingClientRect().top).toBeCloseTo(singleTop, 0);

    await ctx.wrapper.get('[aria-label="关闭区划定位"]').trigger('click');
    expect(ctx.wrapper.find('h2').exists()).toBe(false);
  });

  it('放不下时内容区滚动，滚到底时最后一行下面仍留出外壳的内边距（2026-10-16 用户发现贴着底边）', async () => {
    using ctx = setup(260);
    ctx.group.show('region');
    await nextTick();

    const tabpanel = ctx.wrapper.get('[role="tabpanel"]').element;
    const scroller = tabpanel.parentElement;
    const last = ctx.wrapper.get('[data-row="19"]').element;
    if (!scroller) {
      throw new Error('没有找到内容区');
    }
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);

    scroller.scrollTop = scroller.scrollHeight;
    const gap = scroller.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom;

    expect(gap).toBeCloseTo(16, 0);
  });

  it.each([320, 215])('面板宽 %i 时四个标签和关闭入口完整可见，滚动内容不隐藏标签', async width => {
    using ctx = setup(400, width);
    for (const id of ORDER) {
      ctx.group.show(id);
    }
    await frames(2);

    const list = ctx.wrapper.get('[role="tablist"]').element;
    const tabs = ctx.wrapper.findAll<HTMLButtonElement>('[role="tab"]');
    // 名称可换行，行对齐按完整标签（含关闭按钮）判断
    const boxes = tabs.map(tab => {
      const item = tab.element.parentElement;
      if (!item) {
        throw new Error('没有找到标签容器');
      }
      return item.getBoundingClientRect();
    });
    expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
    expect(boxes[0].top).toBe(boxes[1].top);
    expect(boxes[2].top).toBe(boxes[3].top);
    expect(boxes[2].top).toBeGreaterThan(boxes[0].top);
    const titleStyle = getComputedStyle(ctx.wrapper.get('h2').element);
    const header = ctx.wrapper.get('header').element;
    expect(getComputedStyle(header).backgroundColor).toBe('rgb(241, 244, 248)');
    expect(header.getBoundingClientRect().height).toBe(48);
    expect(header.contains(list)).toBe(false);
    expect(getComputedStyle(list).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    for (const tab of tabs) {
      expect(tabVisible(ctx.wrapper, tab.text())).toBe(true);
      expect(tab.element.scrollWidth).toBeLessThanOrEqual(tab.element.clientWidth);
      const style = getComputedStyle(tab.element);
      expect(style.fontSize).toBe('14px');
      expect(style.fontWeight).toBe(titleStyle.fontWeight);
      expect(style.color).toBe('rgb(31, 41, 55)');
    }

    const scroller = ctx.wrapper.get('[data-panel="legend"]').element.parentElement;
    if (!scroller) {
      throw new Error('没有找到内容区');
    }
    const before = list.getBoundingClientRect().top;
    scroller.scrollTop = scroller.scrollHeight;
    expect(list.getBoundingClientRect().top).toBe(before);

    await ctx.wrapper.get('[aria-label="关闭行政区"]').trigger('click');
    expect(ctx.group.isOpen('boundaries')).toBe(false);
    expect(ctx.group.state.value.open).toHaveLength(3);
    for (const label of ['图例', '坐标定位', '区划定位']) {
      expect(tabVisible(ctx.wrapper, label)).toBe(true);
    }
    await ctx.wrapper.get('[aria-label="关闭全部功能"]').trigger('click');
    expect(ctx.group.state.value.open).toStrictEqual([]);
  });

  it('收起只保留 48 高的标题行，展开后恢复全部标签和原来的内容', async () => {
    using ctx = setup(400);
    for (const id of ORDER) {
      ctx.group.show(id);
    }
    await nextTick();
    await ctx.wrapper.get('[aria-label="收起功能面板"]').trigger('click');

    expect(ctx.wrapper.get('h2').text()).toBe('地图工具');
    expect(ctx.wrapper.find('[role="tablist"]').exists()).toBe(false);
    expect(ctx.wrapper.findAll('[role="tabpanel"]')).toHaveLength(4);
    expect(ctx.wrapper.get('[data-panel="legend"]').isVisible()).toBe(false);
    expect(ctx.wrapper.get('[data-panel-group]').element.getBoundingClientRect().height).toBe(48);
    expect(getComputedStyle(ctx.wrapper.get('header').element).backgroundColor).toBe('rgb(241, 244, 248)');
    expect(ctx.group.state.value.open).toHaveLength(4);

    await ctx.wrapper.get('[aria-label="展开功能面板"]').trigger('click');
    expect(ctx.wrapper.findAll('[role="tab"]')).toHaveLength(4);
    expect(ctx.wrapper.get('[aria-selected="true"]').text()).toBe('图例');
    expect(ctx.wrapper.get('[data-panel="legend"]').isVisible()).toBe(true);
  });
});
