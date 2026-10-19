import 'cesium/Build/Cesium/Widgets/widgets.css';
import { buildModuleUrl, ImageryLayer, Scene } from 'cesium';
import { mount } from '@vue/test-utils';
import { CesiumCanvas, provideMap, type MapHandle } from '@yzt/map-vue';
import { defineComponent, watch } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { MapViewControls } from '@/shared/map/view-controls/MapViewControls';
import { INITIAL_SAMPLE_STYLE_STATE, sampleStyleGroup } from './sample-style';
import { sampleOverlayGroups } from './sample-overlays';

(buildModuleUrl as typeof buildModuleUrl & { setBaseUrl(url: string): void }).setBaseUrl('/cesium/');

type SampleGroup = 'sample' | 'selection' | 'region-clip' | 'region' | 'measure';

// 同时装配真实按钮、相机操作通道和全部本地业务样式，不替换引擎或图层
function setup(onFirstReady?: (map: MapHandle<SampleGroup>, zoomIn: HTMLButtonElement) => void) {
  const host = document.body.appendChild(document.createElement('div'));
  const errors: unknown[] = [];
  let map!: MapHandle<SampleGroup>;
  let camera!: ReturnType<MapHandle<SampleGroup>['useCamera']>;
  const sample = sampleStyleGroup(INITIAL_SAMPLE_STYLE_STATE);
  const overlays = sampleOverlayGroups(INITIAL_SAMPLE_STYLE_STATE);
  const layerCount = sample.layers.length + Object.values(overlays).reduce((sum, group) => sum + group.layers.length, 0);
  const wrapper = mount(defineComponent({
    setup() {
      map = provideMap({
        groups: ['sample', 'selection', 'region-clip', 'region', 'measure'],
        camera: { center: [118.8, 32.05], zoom: 11, bearing: 0, pitch: 0 },
        onError: error => errors.push(error)
      });
      camera = map.useCamera();
      if (onFirstReady) {
        let observed = false;
        watch(map.viewState, state => {
          if (state !== 'ready' || observed) { return; }
          observed = true;
          const zoomIn = host.querySelector<HTMLButtonElement>('button[aria-label="放大"]');
          if (!zoomIn) { throw new Error('首次就绪时缺少放大按钮'); }
          onFirstReady(map, zoomIn);
        }, { flush: 'sync' });
      }
      map.bindStyle({
        sample: () => sample,
        selection: () => overlays.selection,
        'region-clip': () => overlays['region-clip'],
        region: () => overlays.region,
        measure: () => overlays.measure
      });
      return () => (
        <div style={{ width: '800px', height: '600px', position: 'relative' }}>
          <CesiumCanvas assetBaseUrl="/cesium/" />
          <div style={{ position: 'absolute', right: '8px', top: '8px' }}>
            <MapViewControls goToDefaultView={() => {}} zoomRange={{ minZoom: 0, maxZoom: 22 }} />
          </div>
        </div>
      );
    }
  }), { attachTo: host });
  return {
    map, camera, errors, layerCount,
    button: (label: string) => wrapper.get(`button[aria-label="${label}"]`).element,
    canvas: () => wrapper.get('canvas').element,
    [Symbol.dispose]() { wrapper.unmount(); host.remove(); document.body.replaceChildren(); }
  };
}

// 操作前登记稳定帧；排除按钮真正执行前的旧帧，失败和超时都成为可断言的结果
async function settled(map: MapHandle<SampleGroup>, accepts: () => boolean = () => true) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    do {
      // oxlint-disable-next-line no-await-in-loop -- 后一轮只在当前稳定帧仍属于旧相机时等待
      await map.whenSettled(controller.signal);
    } while (!accepts());
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

describe('三维业务样式的视角按钮', () => {
  it('首次就绪但尚未稳定时立即点击真实放大按钮，仍安全完成缩放', async () => {
    // 在首次 ready 通知中同步点击，避免自动化工具的等待掩盖 ready 到 settle 的窗口
    let firstSettled = false;
    let clicked: { readonly state: string; readonly settled: boolean } | undefined;
    let rendering = false;
    let destroyedDuringFrame = 0;
    // oxlint-disable-next-line typescript/unbound-method -- 只记录 SDK 栈边界，调用时保留真实实例
    const render = Scene.prototype.render;
    // oxlint-disable-next-line typescript/unbound-method -- 只记录销毁时机，调用时保留真实实例
    const destroy = ImageryLayer.prototype.destroy;
    using renderProbe = vi.spyOn(Scene.prototype, 'render').mockImplementation(function(this: Scene, time) {
      rendering = true;
      try { return render.call(this, time); }
      finally { rendering = false; }
    });
    using release = vi.spyOn(ImageryLayer.prototype, 'destroy').mockImplementation(function(this: ImageryLayer) {
      if (rendering) { destroyedDuringFrame++; }
      return destroy.call(this);
    });
    using fixture = setup((map, zoomIn) => {
      clicked = { state: map.viewState.value, settled: firstSettled };
      zoomIn.click();
    });
    const initial = new AbortController();
    void fixture.map.whenSettled(initial.signal).then(() => { firstSettled = true; return true; }, () => false);
    try {
      expect(await settled(fixture.map, () => Math.abs(fixture.camera.value.zoom - 12) < 0.00001)).toBe(true);
      expect(clicked).toEqual({ state: 'ready', settled: false });
      expect(fixture.camera.value.zoom).toBeCloseTo(12, 5);
      expect(renderProbe).toHaveBeenCalled();
      expect(release).toHaveBeenCalled();
      expect(destroyedDuringFrame).toBe(0);
      expect(fixture.errors).toEqual([]);
      expect(fixture.map.viewState.value).toBe('ready');
      expect(fixture.map.sourceErrors.value.size).toBe(0);
    } finally {
      initial.abort();
    }
  }, 60000);

  it('真实放大、缩小、连续点击和拖动只在停止后更新影像，且保持地图可用', async () => {
    using fixture = setup();
    const { map, camera, errors } = fixture;
    expect(await settled(map)).toBe(true);
    using release = vi.spyOn(ImageryLayer.prototype, 'destroy');
    // 记录 SDK 绘制本身的耗时，和帧外影像更新分开观察；不以本机时延设跨机器断言
    const renderDurations: number[] = [];
    // oxlint-disable-next-line typescript/unbound-method -- 测量保留原方法，调用时显式绑定 SDK 场景
    const render = Scene.prototype.render;
    using renderProbe = vi.spyOn(Scene.prototype, 'render').mockImplementation(function(this: Scene, time) {
      const startedAt = performance.now();
      try { return render.call(this, time); }
      finally { renderDurations.push(performance.now() - startedAt); }
    });
    const replacements: { readonly action: string; readonly destroyed: number }[] = [];
    for (const [label, target] of [['放大', 12], ['缩小', 11]] as const) {
      const before = release.mock.calls.length;
      const done = settled(map, () => Math.abs(camera.value.zoom - target) < 0.00001);
      // oxlint-disable-next-line no-await-in-loop -- 一次点击完成后再开始下一次反向缩放
      await userEvent.click(fixture.button(label), { timeout: 15000 });
      // oxlint-disable-next-line no-await-in-loop -- 等真实稳定帧后统计本次动画的图层替换
      expect(await done).toBe(true);
      const destroyed = release.mock.calls.length - before;
      replacements.push({ action: label, destroyed });
      expect(destroyed).toBeLessThanOrEqual(fixture.layerCount);
      expect(errors).toEqual([]);
      expect(map.viewState.value).toBe('ready');
    }

    const beforeClicks = release.mock.calls.length;
    await userEvent.click(fixture.button('放大'), { timeout: 15000 });
    await userEvent.click(fixture.button('放大'), { timeout: 15000 });
    // 最后一次点击前再登记，不能把第一次放大到同一级别的旧稳定帧当作整组完成
    const clicked = settled(map, () => Math.abs(camera.value.zoom - 12) < 0.00001);
    await userEvent.click(fixture.button('缩小'), { timeout: 15000 });
    expect(await clicked).toBe(true);
    replacements.push({ action: '连续放大两次再缩小', destroyed: release.mock.calls.length - beforeClicks });
    // 软件渲染可能在两次真实点击之间已完成上一段动画，每次点击最多允许一轮更新
    expect(release.mock.calls.length - beforeClicks).toBeLessThanOrEqual(fixture.layerCount * 3);

    const previousCenter = camera.value.center;
    const beforeDrag = release.mock.calls.length;
    const dragged = settled(map, () => Math.abs(camera.value.center[0] - previousCenter[0]) > 0.0001);
    await userEvent.dragAndDrop(fixture.canvas(), fixture.canvas(), {
      sourcePosition: { x: 330, y: 300 }, targetPosition: { x: 470, y: 300 }, timeout: 3000
    });
    expect(await dragged).toBe(true);
    replacements.push({ action: '拖动', destroyed: release.mock.calls.length - beforeDrag });
    expect(release.mock.calls.length - beforeDrag).toBeLessThanOrEqual(fixture.layerCount);
    expect(errors).toEqual([]);
    expect(map.viewState.value).toBe('ready');
    expect(map.sourceErrors.value.size).toBe(0);
    // oxlint-disable-next-line no-console -- 记录真实动画的影像替换次数，区分按停止更新和逐帧重建
    console.info('三维视角操作的影像替换与渲染耗时', {
      replacements,
      renderCalls: renderProbe.mock.calls.length,
      maximumRenderMs: Math.max(0, ...renderDurations),
      totalRenderMs: renderDurations.reduce((sum, duration) => sum + duration, 0)
    });
  }, 120000);
});
