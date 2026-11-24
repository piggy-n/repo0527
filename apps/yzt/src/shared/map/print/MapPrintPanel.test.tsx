import type { CameraState, ViewKind } from '@mx/map-core';
import { provideMap } from '@mx/map-vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { MapPrintPanel } from './MapPrintPanel';
import type { PrintImage } from './print-image';
import { DEFAULT_PRINT_SETTINGS, type MapPrint, type PrintPhase, type PrintSettings } from './useMapPrint';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

// 打印的拥有者：状态由用例改，操作只记下调用
function fakePrint(preview: PrintImage | null = null) {
  const phase = ref<PrintPhase>('idle');
  const error = ref('');
  const print = {
    phase,
    error,
    preview: vi.fn<MapPrint['preview']>(() => preview),
    run: vi.fn<MapPrint['run']>(async () => ({
      blob: new Blob(['png'], { type: 'image/png' }),
      fileName: '现状底图-20261124-014530.png',
      placement: 'side'
    })),
    skipWait: vi.fn<() => void>(),
    cancel: vi.fn<() => void>()
  };
  return print;
}

// 浮层内容放在提供地图的页面里（没有画布，视图一直没有）；设置由页面持有
function mountPanel(print: MapPrint, dimension: ViewKind = '2d', initial: PrintSettings = DEFAULT_PRINT_SETTINGS) {
  const settings = ref(initial);
  const done = vi.fn<() => void>();
  const Page = defineComponent(() => {
    provideMap({ groups: ['basemap'], camera: CAMERA });
    return () => (
      <MapPrintPanel
        print={print}
        settings={settings.value}
        dimension={dimension}
        onUpdate:settings={(value: PrintSettings) => (settings.value = value)}
        onDone={done}
      />
    );
  });
  const wrapper = mount(Page, { attachTo: document.body });
  return { wrapper, settings, done };
}

const radio = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('label.el-radio-button').find(item => item.text() === label);

const exportButton = (wrapper: VueWrapper) => {
  const found = wrapper.findAll('button').find(item => item.text().includes('导出图片'));
  if (!found) {
    throw new Error('没有导出按钮');
  }
  return found;
};

// jsdom 没有 Canvas 2D：预览画不出来（只看尺寸和说明），下载不真的跳转
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:print');
  vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  // ElMessage 挂在 body 下，不归组件管
  document.querySelectorAll('.el-message').forEach(element => element.remove());
});

describe('MapPrintPanel', () => {
  it('预览：没有就绪的视图时说明原因；有图片时写出导出的像素', async () => {
    const empty = mountPanel(fakePrint());
    await flushPromises();
    expect(empty.wrapper.text()).toContain('地图还没有就绪');

    const canvas = Object.assign(document.createElement('canvas'), { width: 1672, height: 800 });
    const image = { canvas, placement: 'side' };
    const print = fakePrint(image as PrintImage);
    const { wrapper } = mountPanel(print);
    await flushPromises();

    expect(wrapper.get('[data-print-size]').text()).toBe('1672 × 800 像素');
    expect(print.preview).toHaveBeenCalledWith(DEFAULT_PRINT_SETTINGS);
  });

  it('改图例的位置交给页面，预览跟着重画', async () => {
    const print = fakePrint();
    const { wrapper, settings } = mountPanel(print);
    await flushPromises();

    await radio(wrapper, '右下角')?.find('input').setValue(true);
    await flushPromises();

    expect(settings.value).toStrictEqual({ legend: 'corner', double: false });
    expect(print.preview).toHaveBeenLastCalledWith({ legend: 'corner', double: false });
  });

  it('三维只有同屏幕的清晰度：2 倍不能选，导出时也不按 2 倍', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
    const print = fakePrint();
    const { wrapper } = mountPanel(print, '3d', { legend: 'side', double: true });
    await flushPromises();

    expect(radio(wrapper, '2 倍')?.classes()).toContain('is-disabled');
    expect(wrapper.text()).toContain('三维只能同屏幕的清晰度');
    await exportButton(wrapper).trigger('click');
    await flushPromises();
    expect(print.run).toHaveBeenCalledWith({ legend: 'side', double: false });
  });

  it('导出完交给浏览器保存，提示文件名，通知页面关掉浮层', async () => {
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    const print = fakePrint();
    const { wrapper, done } = mountPanel(print);

    await exportButton(wrapper).trigger('click');
    await flushPromises();

    expect(names).toStrictEqual(['现状底图-20261124-014530.png']);
    expect(document.querySelector('.el-message')?.textContent).toContain('已导出 现状底图-20261124-014530.png');
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('右下角放不下改到右侧时在提示里说明；导出失败时不保存、不关', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
    const print = fakePrint();
    const { wrapper, done } = mountPanel(print, '2d', { legend: 'corner', double: false });

    await exportButton(wrapper).trigger('click');
    await flushPromises();
    expect(document.querySelector('.el-message')?.textContent).toContain('图例较长，放在了右侧');

    print.run.mockResolvedValueOnce(null);
    print.error.value = '图片编码失败';
    await exportButton(wrapper).trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('图片编码失败');
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('等加载时可以不等了；关掉浮层（卸载）时放弃导出', async () => {
    const print = fakePrint();
    const { wrapper } = mountPanel(print);
    print.phase.value = 'waiting';
    await flushPromises();

    expect(wrapper.get('[data-print-waiting]').text()).toContain('等待地图加载完成');
    await wrapper.get('[data-print-waiting] button').trigger('click');
    expect(print.skipWait).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    expect(print.cancel).toHaveBeenCalledTimes(1);
  });
});
