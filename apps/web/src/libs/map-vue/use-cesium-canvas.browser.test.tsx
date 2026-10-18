import 'cesium/Build/Cesium/Widgets/widgets.css';
import { buildModuleUrl } from 'cesium';
import { mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { provideMap, type MapHandle } from './provide-map';
import { useCesiumCanvas } from './use-cesium-canvas';
import { injectMapState } from './use-map';

(buildModuleUrl as typeof buildModuleUrl & { setBaseUrl(url: string): void }).setBaseUrl('/cesium/');

/** 等待绑定真实地图的事件，超时以数据返回，确保由断言指出未完成的行为 */
async function outcome<T>(promise: Promise<T>): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), 10000); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** 在公开的稳定帧事件后读画布，不依赖原生 Cesium 出口 */
async function centerPixel(map: MapHandle<'sample'>, host: HTMLElement): Promise<readonly number[] | 'timeout'> {
  const signal = new AbortController();
  try {
    return await outcome(map.whenSettled(signal.signal).then(() => {
      const source = host.querySelector('canvas');
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d');
      if (!source || !context) {
        throw new Error('没有找到测试画布');
      }
      context.drawImage(source, source.width / 2, source.height / 2, 1, 1, 0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    }));
  } finally {
    signal.abort();
  }
}

function fixture() {
  const host = document.body.appendChild(document.createElement('div'));
  let map!: MapHandle<'sample'>;
  let controller!: ReturnType<typeof useCesiumCanvas>;
  const Canvas = defineComponent(() => {
    const container = ref<HTMLElement>();
    controller = useCesiumCanvas(container, () => '/cesium/', () => true, undefined, injectMapState('test'));
    return () => <div ref={container} style={{ width: '512px', height: '512px' }} />;
  });
  const wrapper = mount(defineComponent(() => {
    map = provideMap({ groups: ['sample'], camera: { center: [119, 32], zoom: 8, bearing: 0, pitch: 0 } });
    map.bindStyle({
      sample: () => ({
        sources: {
          local: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
        },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#00ff00' } },
          { id: 'unsupported', type: 'symbol', source: 'local' }
        ]
      })
    });
    return () => <Canvas />;
  }), { attachTo: host });
  let mounted = true;
  const unmount = () => {
    if (mounted) {
      mounted = false;
      wrapper.unmount();
    }
  };
  return {
    host, map, controller, unmount,
    [Symbol.dispose]: () => { unmount(); host.remove(); }
  };
}

describe('三维画布默认加载器', () => {
  it('不支持的单层仅报告诊断，画布和上下文仍就绪、显示背景并可以定位', async () => {
    using report = vi.spyOn(console, 'error').mockImplementation(() => {});
    using ctx = fixture();
    const firstPixel = centerPixel(ctx.map, ctx.host);
    const signal = new AbortController();
    try {
      expect(await outcome(ctx.map.whenReady(signal.signal).then(() => 'ready'))).toBe('ready');
    } finally {
      signal.abort();
    }
    const rendered = await firstPixel;
    expect(ctx.controller.state.value).toEqual({ status: 'ready' });
    expect(ctx.map.viewState.value).toBe('ready');
    expect(ctx.map.failure.value).toBeNull();
    expect(ctx.map.view.value?.kind).toBe('3d');
    expect(ctx.map.sourceErrors.value.size).toBe(0);
    expect(report.mock.calls.some(([error]) => String(error).includes('unsupported'))).toBe(true);
    expect(rendered).toEqual([0, 255, 0, 255]);

    const positioned = centerPixel(ctx.map, ctx.host);
    ctx.map.runCameraOperation(camera => camera.flyTo({ center: [120, 33], zoom: 9 }, { duration: 0 }));
    expect(await positioned).toEqual([0, 255, 0, 255]);
    expect(ctx.map.view.value?.project([120, 33])?.x).toBeCloseTo(256, 1);
    expect(ctx.controller.state.value).toEqual({ status: 'ready' });
    ctx.unmount();
    expect(ctx.host.querySelector('canvas')).toBeNull();
    expect(ctx.map.viewState.value).toBe('idle');
    expect(ctx.map.sourceErrors.value.size).toBe(0);
  }, 30000);
});
