import type { CameraState, ViewKind } from '@mx/map-core';
import { provideMap } from '@mx/map-vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { MapPrintPanel } from './MapPrintPanel';
import type { PrintLegendBlock } from './print-legend';
import {
  DEFAULT_PRINT_SETTINGS,
  type MapPrint,
  type PrintCapture,
  type PrintPhase,
  type PrintResult,
  type PrintSettings
} from './useMapPrint';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

const BLOCKS: PrintLegendBlock[] = [{ title: null, rows: [{ label: '学校点层（2025）', drawSwatch: () => undefined }] }];

// 截下的画面：地图的 CSS 尺寸，屏幕的像素比是 1；图例是给的几组
function captureOf(width: number, height: number, blocks: readonly PrintLegendBlock[] = BLOCKS): PrintCapture {
  const image = Object.assign(document.createElement('canvas'), { width, height });
  return { snapshot: { image, width, height }, blocks };
}

const RESULT: PrintResult = {
  blob: new Blob(['png'], { type: 'image/png' }),
  fileName: '现状底图-20261124-014530.png',
  placement: 'side',
  width: 1672,
  height: 800
};

// 打印的拥有者：状态由用例改，截图给出 capture，操作只记下调用
function fakePrint(capture: PrintCapture | null = null) {
  const phase = ref<PrintPhase>('idle');
  const error = ref('');
  const print = {
    phase,
    error,
    capture: vi.fn<MapPrint['capture']>(async () => capture),
    run: vi.fn<MapPrint['run']>(async () => RESULT),
    skipWait: vi.fn<() => void>(),
    cancel: vi.fn<() => void>()
  };
  return print;
}

// 浮层内容放在提供地图的页面里（没有画布，相机不变）；设置由页面持有
function mountPanel(print: MapPrint, dimension: ViewKind = '2d', initial: PrintSettings = DEFAULT_PRINT_SETTINGS) {
  const settings = ref(initial);
  const done = vi.fn<() => void>();
  const viewer = vi.fn<(open: boolean) => void>();
  const Page = defineComponent(() => {
    provideMap({ groups: ['basemap'], camera: CAMERA });
    return () => (
      <MapPrintPanel
        print={print}
        settings={settings.value}
        dimension={dimension}
        onUpdate:settings={(value: PrintSettings) => (settings.value = value)}
        onDone={done}
        onViewer={viewer}
      />
    );
  });
  const wrapper = mount(Page, { attachTo: document.body });
  return { wrapper, settings, done, viewer };
}

const radio = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('label.el-radio-button').find(item => item.text() === label);

const choose = async (wrapper: VueWrapper, label: string) => {
  await radio(wrapper, label)?.find('input').setValue(true);
  await flushPromises();
};

const sizeText = (wrapper: VueWrapper) => wrapper.get('[data-print-size]').text();

// 标题栏右边的"导出"
const exportButton = (wrapper: VueWrapper) => {
  const found = wrapper
    .get('header')
    .findAll('button')
    .find(item => item.text() === '导出');
  if (!found) {
    throw new Error('标题栏里没有导出');
  }
  return found;
};

const preview = (wrapper: VueWrapper) => wrapper.get('button[aria-label="查看打印预览的大图"]');

// 大图预览挂在 body 下
const viewerElement = () => document.querySelector('.el-image-viewer__wrapper');

const viewerExport = () => {
  const found = [...document.querySelectorAll<HTMLButtonElement>('.el-image-viewer__actions button')].find(
    item => item.textContent === '导出'
  );
  if (!found) {
    throw new Error('大图的工具栏里没有导出');
  }
  return found;
};

// 图片地址：大图用的地址和释放
let createUrl: MockInstance<typeof URL.createObjectURL>;
let revokeUrl: MockInstance<typeof URL.revokeObjectURL>;

// jsdom 没有 Canvas 2D：合成和预览用什么也不画的假上下文，量文字按字数；下载不真的跳转
beforeEach(() => {
  const context = new Proxy(
    { measureText: (text: string) => ({ width: text.length * 12 }) },
    {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined),
      set: () => true
    }
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as RenderingContext);
  createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:print');
  revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  // ElMessage、大图预览挂在 body 下，不归组件管
  document.querySelectorAll('.el-message, .el-image-viewer__wrapper').forEach(element => element.remove());
});

describe('MapPrintPanel', () => {
  it('预览：打开时等画面完整截一次（带图例），写出导出的像素；等的时候、没有就绪的视图时说明', async () => {
    let finish: ((capture: PrintCapture | null) => void) | undefined;
    const print = fakePrint();
    print.capture.mockImplementationOnce(() => new Promise(resolve => (finish = resolve)));
    const { wrapper } = mountPanel(print);
    await flushPromises();
    expect(wrapper.text()).toContain('等待地图加载完成');
    expect(wrapper.find('[data-print-size]').exists()).toBe(false);

    finish?.(captureOf(1440, 800));
    await flushPromises();
    expect(sizeText(wrapper)).toBe('1672 × 800 像素');
    expect(print.capture).toHaveBeenCalledTimes(1);
    expect(print.capture).toHaveBeenCalledWith(true, expect.any(AbortSignal));

    const empty = mountPanel(fakePrint(null));
    await flushPromises();
    expect(empty.wrapper.text()).toContain('地图还没有就绪');
  });

  it('改图例的位置只重新合成、只改清晰度时预览不变，都不再截图、查要素', async () => {
    const print = fakePrint(captureOf(1440, 800));
    const { wrapper, settings } = mountPanel(print);
    await flushPromises();

    await choose(wrapper, '右下角');
    expect(settings.value).toStrictEqual({ legend: 'corner', double: false });
    expect(sizeText(wrapper)).toBe('1440 × 800 像素');
    await choose(wrapper, '不带');
    await choose(wrapper, '右侧一栏');
    expect(sizeText(wrapper)).toBe('1672 × 800 像素');
    await choose(wrapper, '2 倍');

    expect(settings.value).toStrictEqual({ legend: 'side', double: true });
    expect(print.capture).toHaveBeenCalledTimes(1);
  });

  it('打开时不带图例就不查；换成带图例时重新截一次', async () => {
    const print = fakePrint(captureOf(1440, 800));
    const { wrapper } = mountPanel(print, '2d', { legend: 'none', double: false });
    await flushPromises();
    expect(print.capture).toHaveBeenLastCalledWith(false, expect.any(AbortSignal));
    expect(sizeText(wrapper)).toBe('1440 × 800 像素');

    await choose(wrapper, '右下角');

    expect(print.capture).toHaveBeenCalledTimes(2);
    expect(print.capture).toHaveBeenLastCalledWith(true, expect.any(AbortSignal));
  });

  it('选了 2 倍时写出按 2 倍像素比导出的尺寸，地图受画布上限 4096 约束', async () => {
    const print = fakePrint(captureOf(2560, 1200, []));
    const { wrapper } = mountPanel(print, '2d', { legend: 'side', double: true });
    await flushPromises();

    // 4096 ÷ 2560 = 1.6
    expect(sizeText(wrapper)).toBe('4096 × 1920 像素');
    await choose(wrapper, '同屏幕');
    expect(sizeText(wrapper)).toBe('2560 × 1200 像素');
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

  it('标题栏是"地图打印"，导出在右边、是链接样式；导出时"导出"转圈，图例、清晰度、预览都不能点', async () => {
    const print = fakePrint(captureOf(1440, 800));
    print.run.mockImplementationOnce(() => new Promise(() => undefined));
    const { wrapper } = mountPanel(print);
    await flushPromises();
    expect(wrapper.get('header').text()).toContain('地图打印');
    expect(exportButton(wrapper).classes()).toContain('is-link');
    expect(preview(wrapper).attributes('disabled')).toBeUndefined();

    await exportButton(wrapper).trigger('click');
    print.phase.value = 'waiting';
    await flushPromises();

    expect(exportButton(wrapper).classes()).toContain('is-loading');
    expect(preview(wrapper).attributes('disabled')).toBeDefined();
    expect(radio(wrapper, '右下角')?.classes()).toContain('is-disabled');
    expect(radio(wrapper, '2 倍')?.classes()).toContain('is-disabled');
  });

  it('预览下面那一行：平时是像素，等加载、生成时说明，失败时是原因', async () => {
    const print = fakePrint(captureOf(1440, 800));
    const { wrapper } = mountPanel(print);
    await flushPromises();
    const line = () => wrapper.get('[aria-label="查看打印预览的大图"] + div');
    expect(line().text()).toBe('1672 × 800 像素');

    print.phase.value = 'waiting';
    await flushPromises();
    expect(line().text()).toBe('等待地图加载完成不等了');
    print.phase.value = 'composing';
    await flushPromises();
    expect(line().text()).toBe('正在生成图片');
    print.phase.value = 'idle';
    print.error.value = '地图在等待时发生了变化，请重新导出';
    await flushPromises();
    expect(line().attributes('role')).toBe('alert');
    expect(line().text()).toBe('地图在等待时发生了变化，请重新导出');
  });

  it('点预览按现在的设置生成导出的那张图，用图片预览看大图；大图里导出的就是这张，不再生成', async () => {
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    const print = fakePrint(captureOf(1440, 800));
    const { wrapper, done, viewer } = mountPanel(print, '2d', { legend: 'corner', double: false });
    await flushPromises();

    await preview(wrapper).trigger('click');
    await flushPromises();

    expect(print.run).toHaveBeenCalledExactlyOnceWith({ legend: 'corner', double: false });
    expect(viewerElement()?.querySelector('img')?.getAttribute('src')).toBe('blob:print');
    // 右下角放不下改到了右侧：大图下面就说明
    expect(viewerElement()?.querySelector('[data-print-viewer-info]')?.textContent).toBe(
      '打印预览：1672 × 800 像素，图例较长，放在了右侧'
    );
    expect(viewer.mock.calls).toStrictEqual([[true]]);
    expect(done).not.toHaveBeenCalled();

    viewerExport().click();
    await flushPromises();

    expect(print.run).toHaveBeenCalledTimes(1);
    expect(names).toStrictEqual(['现状底图-20261124-014530.png']);
    expect(document.querySelector('.el-message')?.textContent).toContain('图例较长，放在了右侧');
    expect(revokeUrl).toHaveBeenCalledWith('blob:print');
    expect(viewer.mock.calls).toStrictEqual([[true], [false]]);
    expect(done).toHaveBeenCalledTimes(1);
    expect(viewerElement()).toBeNull();
  });

  it('关掉大图时释放图片、不保存；还没有预览时不能点', async () => {
    const save = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
    let finish: ((capture: PrintCapture | null) => void) | undefined;
    const print = fakePrint();
    print.capture.mockImplementationOnce(() => new Promise(resolve => (finish = resolve)));
    const { wrapper, done, viewer } = mountPanel(print);
    await flushPromises();
    expect(preview(wrapper).attributes('disabled')).toBeDefined();
    finish?.(captureOf(1440, 800));
    await flushPromises();

    await preview(wrapper).trigger('click');
    await flushPromises();
    document.querySelector<HTMLElement>('.el-image-viewer__close')?.click();
    await flushPromises();

    expect(viewerElement()).toBeNull();
    expect(revokeUrl).toHaveBeenCalledWith('blob:print');
    expect(viewer.mock.calls).toStrictEqual([[true], [false]]);
    expect(save).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });

  it('生成大图时关掉浮层（卸载）：放弃生成，晚到的结果不显示', async () => {
    let finish: ((result: PrintResult | null) => void) | undefined;
    const print = fakePrint(captureOf(1440, 800));
    print.run.mockImplementationOnce(() => new Promise(resolve => (finish = resolve)));
    const { wrapper, viewer } = mountPanel(print);
    await flushPromises();
    await preview(wrapper).trigger('click');

    wrapper.unmount();
    finish?.(RESULT);
    await flushPromises();

    expect(print.cancel).toHaveBeenCalledTimes(1);
    expect(createUrl).not.toHaveBeenCalled();
    expect(viewerElement()).toBeNull();
    expect(viewer).not.toHaveBeenCalled();
  });
});
