import type { ViewBounds } from '@yzt/map-core';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, ref } from 'vue';
import { MapCanvas } from './MapCanvas';
import { type MapHandle, provideMap } from './provide-map';
import { useMapOverlay } from './use-map';

// 真实的布局和 MapLibre（ADR 0040）：jsdom 里元素的尺寸都是 0，悬浮元素的避让只能在浏览器里验证

const CAMERA = { center: [119.4, 32.9] as const, zoom: 6, bearing: 0, pitch: 0 };
const BOUNDS: ViewBounds = [118, 31, 120, 33];
const WAIT_TIMEOUT = 5000;

// 贴着画布左边的面板：左 16、宽 320，所以避让后左边的留白是 16 + 320 + 间隔 16 = 352
const Panel = defineComponent(() => {
  const element = ref<HTMLElement>();
  useMapOverlay(element, 'left');
  return () => (
    <aside ref={element} style={{ position: 'absolute', left: '16px', top: '16px', width: '320px', height: '568px' }} />
  );
});

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${WAIT_TIMEOUT} ms 内没有等到${label}`)), WAIT_TIMEOUT);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 页面：800 × 600 的画布，左边一个登记过的面板；挂到自己的容器上，结束时卸载组件并移除容器
function setup() {
  const host = document.body.appendChild(document.createElement('div'));
  let handle: MapHandle<'data'> | undefined;
  const wrapper = mount(
    defineComponent(() => {
      handle = provideMap({ groups: ['data'], camera: CAMERA });
      return () => (
        <div style={{ position: 'relative', width: '800px', height: '600px' }}>
          <MapCanvas />
          <Panel />
        </div>
      );
    }),
    { attachTo: host }
  );
  if (!handle) {
    throw new Error('没有创建地图');
  }
  return {
    handle,
    [Symbol.dispose]() {
      wrapper.unmount();
      host.remove();
    }
  };
}

describe('定位可视区域（真实的布局）', () => {
  it('登记的面板按实际尺寸算进留白；不传 padding 的 fitBounds 把范围放在面板右边的区域里', async () => {
    using page = setup();
    const { handle } = page;
    await withTimeout(handle.whenReady(), '地图就绪');

    expect(handle.overlayPadding()).toStrictEqual({ top: 16, right: 16, bottom: 16, left: 352 });
    handle.runCameraOperation(camera => camera.fitBounds(BOUNDS, { duration: 0 }));

    const view = handle.view.value;
    const southWest = view?.project([BOUNDS[0], BOUNDS[1]]);
    const northEast = view?.project([BOUNDS[2], BOUNDS[3]]);
    expect(southWest?.x).toBeGreaterThanOrEqual(352 - 1);
    expect(northEast?.x).toBeLessThanOrEqual(800 - 16 + 1);
    expect(northEast?.y).toBeGreaterThanOrEqual(16 - 1);
    expect(southWest?.y).toBeLessThanOrEqual(600 - 16 + 1);
    // 范围的宽或高至少有一边贴满可视区域，说明是按可视区域适配的，而不是整张画布
    const width = (northEast?.x ?? 0) - (southWest?.x ?? 0);
    const height = (southWest?.y ?? 0) - (northEast?.y ?? 0);
    expect(Math.max(width / (800 - 16 - 352), height / (600 - 16 - 16))).toBeCloseTo(1, 1);
  });
});
