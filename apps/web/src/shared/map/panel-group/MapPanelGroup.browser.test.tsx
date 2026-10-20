import 'element-plus/dist/index.css';
import type { CameraState } from '@yzt/map-core';
import { provideMap } from '@yzt/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { MapPanelGroup } from './MapPanelGroup';
import { type PanelGroup, usePanelGroup } from './usePanelGroup';

// 真实的布局（ADR 0040）：jsdom 里元素的尺寸都是 0，滚动区域的留白、Tab 的横向滚动只能在浏览器里验证

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };
const ORDER = ['region', 'coordinate', 'detail'] as const;
type Id = (typeof ORDER)[number];
const LABELS = { region: '区划定位', coordinate: '坐标定位', detail: '资源详情' };

// 用到的令牌由 app 的样式给出，这里直接写出
const TOKENS = {
  '--space-sm': '8px',
  '--space-md': '12px',
  '--space-lg': '16px',
  '--font-size-base': '14px',
  '--font-size-lg': '16px',
  '--font-weight-semibold': '600'
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
      group = owned;
      return () => (
        <div style={{ display: 'flex', flexDirection: 'column', width: `${width}px`, height: `${height}px`, ...TOKENS }}>
          <MapPanelGroup group={owned} labels={LABELS} visible>
            {{ region: rows, coordinate: rows, detail: rows }}
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
  return box.left >= list.left - 0.5 && box.right <= list.right + 0.5;
}

describe('MapPanelGroup（真实的布局）', () => {
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

  it('手机宽度时三个功能放不下：Tab 区横向滚动，当前的 Tab 连同关闭按钮在可见范围里（2026-10-16 评审发现被裁切）', async () => {
    // 窄面板的标题区同时保留统一关闭按钮，标签需要横向滚动
    using ctx = setup(400, 215);
    ctx.group.show('region');
    ctx.group.show('coordinate');
    ctx.group.show('detail');
    await frames(2);

    const list = ctx.wrapper.get('[role="tablist"]').element;
    const shell = ctx.wrapper.get('[data-panel-group]').element.firstElementChild;
    if (!shell) {
      throw new Error('没有找到外壳');
    }
    expect(list.scrollWidth).toBeGreaterThan(list.clientWidth);
    expect(list.getBoundingClientRect().right).toBeLessThanOrEqual(shell.getBoundingClientRect().right);
    expect(tabVisible(ctx.wrapper, '资源详情')).toBe(true);
    expect(tabVisible(ctx.wrapper, '区划定位')).toBe(false);

    // 点击已有标签只切换：滚到后面的区划定位
    ctx.group.select('region');
    await frames(2);
    expect(tabVisible(ctx.wrapper, '区划定位')).toBe(true);

    // 再从入口调用当前功能：只变顺序，仍应重新滚到最前面
    ctx.group.show('region');
    await frames(2);
    expect(ctx.group.state.value.open[0]).toBe('region');
    expect(tabVisible(ctx.wrapper, '区划定位')).toBe(true);
  });
});
