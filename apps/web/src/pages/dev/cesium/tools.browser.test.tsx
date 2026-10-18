import 'cesium/Build/Cesium/Widgets/widgets.css';
// oxlint-disable-next-line no-restricted-imports -- 独立浏览器验收准备本地二维运行时，不依赖 app
import 'maplibre-gl/dist/maplibre-gl.css';
// oxlint-disable-next-line no-restricted-imports -- 独立浏览器验收使用发布包的本地 Worker
import { setWorkerUrl } from 'maplibre-gl';
// oxlint-disable-next-line no-restricted-imports -- 独立浏览器验收使用发布包的本地 Worker
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { buildModuleUrl } from 'cesium';
import { mount } from '@vue/test-utils';
import {
  geodesicArea, geodesicDistance, lineLength, type CameraState, type MapInputEvent, type ScreenPoint, type ViewKind
} from '@yzt/map-core';
import { provideMap, SwitchableMapCanvas, type MapHandle, type SwitchableMapCanvasHandle } from '@yzt/map-vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { defineComponent, nextTick, ref, type ShallowRef } from 'vue';
import { LOCATION_PICK_TOOL, useLocationPoint, type LocationPointOwner } from '@/shared/map/location/useLocationPoint';
import { MEASURE_TOOL_IDS, useMeasure, type Measure } from '@/shared/map/measure/useMeasure';
import { useMapReadout, type MapReadout } from '@/shared/map/status-bar/useMapReadout';

(buildModuleUrl as typeof buildModuleUrl & { setBaseUrl(url: string): void }).setBaseUrl('/cesium/');
setWorkerUrl(workerUrl);

afterEach(() => { document.body.replaceChildren(); });

// 仅装配公共工具和本地测量样式，避免业务瓦片负载掩盖输入与切换契约
function setup() {
  const host = document.body.appendChild(document.createElement('div'));
  host.style.cssText = 'width:800px;height:600px;position:relative;';
  const canvas = ref<SwitchableMapCanvasHandle>();
  const active = ref(true);
  const errors: unknown[] = [];
  const probeInputs: MapInputEvent[] = [];
  let map!: MapHandle<'sample' | 'measure'>;
  let measure!: Measure;
  let location!: LocationPointOwner;
  let readout!: MapReadout;
  let camera!: Readonly<ShallowRef<CameraState>>;
  const wrapper = mount(defineComponent({
    setup() {
      map = provideMap({
        groups: ['sample', 'measure'],
        camera: { center: [118.8, 32.05], zoom: 11, bearing: 0, pitch: 0 },
        onError: error => errors.push(error)
      });
      measure = useMeasure();
      location = useLocationPoint(map, { regions: { districtCodeAt: async () => null } });
      readout = useMapReadout(map);
      camera = map.useCamera();
      map.registerTools({
        ...measure.tools, ...location.tools,
        'box-probe': {
          supportedViews: ['2d', '3d'], persistent: true, cursor: 'crosshair',
          gestures: { dragPan: false, boxZoom: false }, panModifier: 'ctrl',
          handleInput: event => { probeInputs.push(event); }
        }
      });
      map.bindStyle({
        sample: () => ({ sources: {}, layers: [{ id: 'sample-white', type: 'background', paint: {
          'background-color': '#ffffff'
        } }] }),
        measure: measure.deriveGroup
      });
      return () => (
        <div style={{ width: '800px', height: '600px' }}>
          <SwitchableMapCanvas
            ref={canvas}
            active={active.value}
            assetBaseUrl="/cesium/"
            prepareRuntime={async () => {}}
            mapOptions={{ maxZoom: 15 }}
            scrollZoomRates={{ wheel: 1 / 450, trackpad: 1 / 100 }}
          />
        </div>
      );
    }
  }), { attachTo: host });
  const waitReady = (kind: ViewKind) => vi.waitFor(() => expect(map.view.value?.kind).toBe(kind), { timeout: 15000 });
  return {
    map, measure, location, readout, camera, active, errors, probeInputs, waitReady,
    async switchTo(kind: ViewKind) {
      void canvas.value?.switchTo(kind);
      await waitReady(kind);
      await nextTick();
    },
    canvas(): HTMLCanvasElement {
      const found = host.querySelector(`[data-map-view="${map.view.value?.kind}"] canvas`);
      if (!(found instanceof HTMLCanvasElement)) {
        throw new Error('当前视图没有画布');
      }
      expect(found.clientWidth).toBe(800);
      expect(found.clientHeight).toBe(600);
      return found;
    },
    [Symbol.dispose]() { wrapper.unmount(); host.remove(); }
  };
}

// Playwright 产生真正的指针捕获和点击序列，双击第二个 click 不应重复记点
function click(canvas: HTMLCanvasElement, point: ScreenPoint, count = 1) {
  return count === 2 ? userEvent.dblClick(canvas, { position: point, timeout: 3000 })
    : userEvent.click(canvas, { position: point, timeout: 3000 });
}

function move(canvas: HTMLCanvasElement, point: ScreenPoint) {
  return userEvent.hover(canvas, { position: point, timeout: 3000 });
}

// 操作前登记稳定帧，超时中止订阅并交给断言报告
function settled(map: MapHandle<'sample' | 'measure'>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  return map.whenSettled(controller.signal).then(() => true, () => false).finally(() => clearTimeout(timer));
}

// 引擎把指针移动合并到渲染帧，等待两帧覆盖松开后的手势收尾
function frames() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  return Promise.race([
    new Promise<boolean>(resolve => {
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => resolve(true)); });
    }),
    new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 5000); })
  ]).finally(() => { clearTimeout(timer); cancelAnimationFrame(frame); });
}

async function drag(canvas: HTMLCanvasElement, ctrl = false) {
  if (ctrl) {
    await userEvent.keyboard('{Control>}');
  }
  try {
    await userEvent.dragAndDrop(canvas, canvas, {
      sourcePosition: { x: 360, y: 300 }, targetPosition: { x: 480, y: 300 }, timeout: 3000
    });
    expect(await frames()).toBe(true);
  } finally {
    if (ctrl) {
      await userEvent.keyboard('{/Control}');
    }
  }
}

describe('三维公共工具验收', () => {
  it('真实二三维切换保留测量顶点，清预览；三维距离和面积仍按椭球计算，双击不改变相机', async () => {
    using fixture = setup();
    const { map, measure } = fixture;
    await fixture.waitReady('2d');
    map.activateTool(MEASURE_TOOL_IDS.distance);
    await click(fixture.canvas(), { x: 320, y: 260 });
    await click(fixture.canvas(), { x: 420, y: 300 });
    await move(fixture.canvas(), { x: 470, y: 330 });
    expect(measure.state.value.draft?.points).toHaveLength(2);
    expect(measure.state.value.draft?.preview).not.toBeNull();
    const confirmed = measure.state.value.draft?.points;
    await fixture.switchTo('3d');
    expect(map.activeTool.value).toBe(MEASURE_TOOL_IDS.distance);
    expect(measure.state.value.draft?.points).toEqual(confirmed);
    expect(measure.state.value.draft?.preview).toBeNull();
    expect(measure.pointer.value).toBeNull();
    const cameraBefore = fixture.camera.value;
    const finished = settled(map);
    await click(fixture.canvas(), { x: 490, y: 340 }, 2);
    expect(measure.state.value.draft).toBeNull();
    const distance = measure.state.value.measurements[0];
    expect(distance?.points).toHaveLength(3);
    expect(distance?.method).toBe('geodesic');
    expect(distance?.value).toBe(lineLength(distance?.points ?? []));
    expect(await finished).toBe(true);
    expect(fixture.camera.value).toEqual(cameraBefore);

    map.activateTool(MEASURE_TOOL_IDS.area);
    await click(fixture.canvas(), { x: 320, y: 260 });
    await click(fixture.canvas(), { x: 450, y: 260 });
    await click(fixture.canvas(), { x: 450, y: 360 }, 2);
    const area = measure.state.value.measurements[1];
    expect(area?.points).toHaveLength(3);
    expect(area?.value).toBe(geodesicArea(area?.points ?? []));
    await click(fixture.canvas(), { x: 330, y: 300 });
    await move(fixture.canvas(), { x: 440, y: 350 });
    fixture.active.value = false;
    await nextTick();
    expect(measure.state.value.draft?.points).toHaveLength(1);
    expect(measure.state.value.draft?.preview).toBeNull();
    expect(measure.pointer.value).toBeNull();
    fixture.active.value = true;
    await fixture.waitReady('3d');
    await fixture.switchTo('2d');
    expect(measure.state.value.measurements).toHaveLength(2);
    expect(measure.state.value.draft?.points).toHaveLength(1);
    map.runCameraOperation(control => control.flyTo({ zoom: 20 }, { duration: 0 }));
    await vi.waitFor(() => expect(fixture.camera.value.zoom).toBe(15));
    expect(fixture.errors).toEqual([]);
  }, 40000);

  it('三维坐标定位、位置拾取与状态栏保留椭球语义，天空不生成位置或测量点', async () => {
    using fixture = setup();
    const { map, location, readout, measure } = fixture;
    await fixture.waitReady('2d');
    await fixture.switchTo('3d');
    location.locate([119, 32.2]);
    await vi.waitFor(() => {
      expect(fixture.camera.value.center[0]).toBeCloseTo(119, 5);
      expect(fixture.camera.value.center[1]).toBeCloseTo(32.2, 5);
      expect(fixture.camera.value.zoom).toBeCloseTo(14, 5);
    }, { timeout: 5000 });
    expect(location.state.value.point).toEqual({ lngLat: [119, 32.2], source: 'input' });
    map.activateTool(LOCATION_PICK_TOOL);
    await move(fixture.canvas(), { x: 400, y: 300 });
    await click(fixture.canvas(), { x: 400, y: 300 });
    expect(location.state.value.point?.source).toBe('pick');
    expect(location.state.value.infoOpen).toBe(true);
    expect(map.activeTool.value).toBe('browse');
    await vi.waitFor(() => expect(readout.position.value?.surface).toBe('ellipsoid'));
    const picked = map.view.value?.pick(map.pointer.value ?? { x: 400, y: 300 });
    expect(picked?.kind).toBe('hit');
    // globe 的三角网可能给出厘米级负椭球高，读数忠实保留，不能当成真实高程
    expect(readout.position.value?.height).toBe(picked?.kind === 'hit' ? picked.height : undefined);

    map.runCameraOperation(control => control.flyTo({ zoom: 0, pitch: 0 }, { duration: 0 }));
    await vi.waitFor(() => expect(fixture.camera.value.zoom).toBeCloseTo(0, 5));
    const sky = { x: 4, y: 4 };
    expect(map.view.value?.pick(sky)).toEqual({ kind: 'miss' });
    const placed = location.state.value.point;
    map.activateTool(LOCATION_PICK_TOOL);
    await click(fixture.canvas(), sky);
    expect(location.state.value.point).toBe(placed);
    expect(map.activeTool.value).toBe(LOCATION_PICK_TOOL);
    await move(fixture.canvas(), sky);
    await vi.waitFor(() => expect(readout.position.value).toBeNull());
    map.activateTool(MEASURE_TOOL_IDS.distance);
    await click(fixture.canvas(), sky);
    expect(measure.state.value.draft).toBeNull();
    await fixture.switchTo('2d');
    expect(location.state.value.point).toBe(placed);
    expect(readout.position.value?.surface).toBe('map');
    expect(readout.position.value?.height).toBeUndefined();
    expect(fixture.errors).toEqual([]);
  }, 40000);

  it('真实浏览拖动和Ctrl临时平移会移动相机，框选普通拖动不移动，测量拖动不加点', async () => {
    using fixture = setup();
    const { map, measure, probeInputs } = fixture;
    await fixture.waitReady('2d');
    await fixture.switchTo('3d');
    const original = fixture.camera.value;
    const browsed = settled(map);
    await drag(fixture.canvas());
    expect(await browsed).toBe(true);
    expect(geodesicDistance(original.center, fixture.camera.value.center)).toBeGreaterThan(1);
    map.activateTool('box-probe');
    const beforeBox = fixture.camera.value;
    await drag(fixture.canvas());
    expect(fixture.camera.value).toEqual(beforeBox);
    expect(probeInputs.map(event => event.type)).toContain('down');
    expect(probeInputs.map(event => event.type)).toContain('up');
    expect(probeInputs.map(event => event.type)).not.toContain('click');
    probeInputs.length = 0;
    const panned = settled(map);
    await drag(fixture.canvas(), true);
    expect(await panned).toBe(true);
    expect(geodesicDistance(beforeBox.center, fixture.camera.value.center)).toBeGreaterThan(1);
    expect(probeInputs.filter(event => event.type === 'down' || event.type === 'up' || event.type === 'click'))
      .toEqual([]);
    expect(fixture.camera.value.pitch).toBeCloseTo(beforeBox.pitch, 5);
    const bearingDelta = (fixture.camera.value.bearing - beforeBox.bearing + 540) % 360 - 180;
    expect(bearingDelta).toBeCloseTo(0, 5);
    map.activateTool(MEASURE_TOOL_IDS.distance);
    const beforeMeasure = fixture.camera.value;
    const measuredPan = settled(map);
    await drag(fixture.canvas());
    expect(await measuredPan).toBe(true);
    expect(geodesicDistance(beforeMeasure.center, fixture.camera.value.center)).toBeGreaterThan(1);
    expect(measure.state.value.draft).toBeNull();
    expect(measure.state.value.measurements).toEqual([]);
    expect(fixture.errors).toEqual([]);
  }, 30000);
});
