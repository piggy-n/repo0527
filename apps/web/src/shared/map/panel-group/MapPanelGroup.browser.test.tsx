import type { CameraState } from '@yzt/map-core';
import { provideMap } from '@yzt/map-vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { MapPanelGroup } from './MapPanelGroup';
import { type PanelGroup, usePanelGroup } from './usePanelGroup';

// 真实的布局（ADR 0040）：jsdom 里元素的尺寸都是 0，滚动区域的留白只能在浏览器里验证

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };
const ORDER = ['region'] as const;
const LABELS = { region: '区划定位' };

// 页面上压缩面板组的纵向 flex 容器，高度放不下内容；令牌由 app 的样式给出，这里直接写出用到的几个
function setup(height: number) {
  const host = document.body.appendChild(document.createElement('div'));
  let group: PanelGroup<'region'> | undefined;
  const wrapper = mount(
    defineComponent(() => {
      provideMap({ groups: [], camera: CAMERA });
      const owned = usePanelGroup(ORDER);
      group = owned;
      return () => (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '320px',
            height: `${height}px`,
            '--space-sm': '8px',
            '--space-md': '12px',
            '--space-lg': '16px'
          }}>
          <MapPanelGroup group={owned} labels={LABELS} visible>
            {{
              region: () => [
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {Array.from({ length: 20 }, (_, index) => (
                    <div key={index} style={{ height: '28px', flex: 'none' }} data-row={index} />
                  ))}
                </div>
              ]
            }}
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
});
