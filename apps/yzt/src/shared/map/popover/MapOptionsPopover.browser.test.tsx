import 'element-plus/dist/index.css';
import type { CameraState } from '@mx/map-core';
import { provideMap } from '@mx/map-vue';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { MapOptionsPopover } from './MapOptionsPopover';

// 真实的布局（ADR 0040）：jsdom 里元素的尺寸都是 0，定位只能在浏览器里验证

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

// 内容自己持有状态，和底图面板一样：变高时外壳不重新渲染，外壳重新渲染时也不会把它冲掉
const tall = ref(false);
const Content = defineComponent(() => () => <div data-sample style={{ height: tall.value ? '300px' : '60px' }} />);

function setup() {
  tall.value = false;
  const tops: (number | null)[] = [];
  const wrapper = mount(
    defineComponent(() => {
      provideMap({ groups: [], camera: CAMERA });
      return () => (
        // 和底图卡一样贴着视口的右下角
        <div style={{ position: 'fixed', right: '16px', bottom: '16px', width: '80px', height: '56px' }}>
          <MapOptionsPopover name="sample" open onTopChange={top => tops.push(top)}>
            {{
              reference: () => [<button type="button">入口</button>],
              default: () => [<Content />]
            }}
          </MapOptionsPopover>
        </div>
      );
    }),
    { attachTo: document.body }
  );
  return { wrapper, tops };
}

function sample(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-sample]');
  if (!element) {
    throw new Error('浮层的内容还没有显示');
  }
  return element;
}

const popperBox = () => {
  const popper = sample().closest('.el-popper');
  if (!popper) {
    throw new Error('内容不在 Element 的弹出层里');
  }
  return popper.getBoundingClientRect();
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('MapOptionsPopover', () => {
  it('打开时就显示的内容变高后重新定位：不超出视口，上方的面板拿到新的顶部', async () => {
    const { tops } = setup();
    await vi.waitFor(() => expect(tops.at(-1)).toBe(popperBox().top));
    const collapsedTop = popperBox().top;

    tall.value = true;

    await vi.waitFor(() => {
      const box = popperBox();
      expect(box.top).toBeLessThan(collapsedTop);
      expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
      expect(tops.at(-1)).toBe(box.top);
    });
  });

  it('内容只有入口那么高时也在视口里，高度跟着内容走', async () => {
    const { tops } = setup();
    await vi.waitFor(() => expect(tops.at(-1)).toBe(popperBox().top));

    const box = popperBox();
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
    // 内容 60、四周留 12（令牌没有加载时内边距为 0，所以只比较不小于内容）
    expect(box.height).toBeGreaterThanOrEqual(60);
  });
});
