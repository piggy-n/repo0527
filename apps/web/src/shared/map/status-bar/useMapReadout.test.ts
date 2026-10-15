// @vitest-environment node
import type { CameraState, LngLat, PickResult, ScreenPoint } from '@yzt/map-core';
import type { MapViewport } from '@yzt/map-vue';
import { describe, expect, it } from 'vitest';
import { effectScope, ref, shallowRef } from 'vue';
import { useMapReadout } from './useMapReadout';

// 假视图：(500, 300) 是相机的中心，每像素 degreesPerPixel 度；换算不受 Vue 跟踪，改了以后要加投影修订号
function fakeViewport(camera: { readonly value: CameraState }) {
  const projection = { degreesPerPixel: 0.01, miss: false };
  const picks: ScreenPoint[] = [];
  const viewport: MapViewport = {
    kind: '2d',
    pick: (point: ScreenPoint): PickResult => {
      picks.push(point);
      if (projection.miss) {
        return { kind: 'miss' };
      }
      const [lng, lat] = camera.value.center;
      const { degreesPerPixel } = projection;
      return {
        kind: 'hit',
        surface: 'map',
        lngLat: [lng + (point.x - 500) * degreesPerPixel, lat - (point.y - 300) * degreesPerPixel]
      };
    },
    project: () => ({ x: 500, y: 300 }),
    queryRendered: () => []
  };
  return { viewport, projection, picks };
}

function setup() {
  const camera = shallowRef<CameraState>({ center: [118.8, 32], zoom: 9, bearing: 0, pitch: 0 });
  const view = shallowRef<MapViewport | null>(null);
  const pointer = shallowRef<ScreenPoint | null>(null);
  const projectionRevision = ref(0);
  const fake = fakeViewport(camera);
  const scope = effectScope();
  const readout = scope.run(() => useMapReadout({ view, pointer, projectionRevision, useCamera: () => camera }));
  if (!readout) {
    throw new Error('作用域没有运行');
  }
  return {
    readout,
    camera,
    view,
    pointer,
    projectionRevision,
    ...fake,
    [Symbol.dispose]: () => scope.stop()
  };
}

const lngLatOf = (position: { readonly lngLat: LngLat } | null) => position?.lngLat.map(value => value.toFixed(2));

describe('useMapReadout', () => {
  it('视图不在就绪时比例尺和经纬度都为 null，角度照常', () => {
    using ctx = setup();
    ctx.camera.value = { ...ctx.camera.value, bearing: 345, pitch: 30.4 };

    expect(ctx.readout.scale.value).toBeNull();
    expect(ctx.readout.position.value).toBeNull();
    expect(ctx.readout.angles.value).toStrictEqual({ bearing: -15, pitch: 30 });
  });

  it('比例尺：在相机中心投影到的水平线上取相距 100 像素的两点，按椭球面算距离', () => {
    using ctx = setup();
    ctx.view.value = ctx.viewport;

    // 100 像素是 1 个经度，北纬 32° 约 94.6 千米，80 像素约 75.7 千米，取 50 千米
    expect(ctx.readout.scale.value?.label).toBe('50 km');
    expect(ctx.picks).toStrictEqual([
      { x: 450, y: 300 },
      { x: 550, y: 300 }
    ]);
  });

  it('经纬度：鼠标在画布上时拾取它下面的点；不在画布上时是画布中心，标为中心', () => {
    using ctx = setup();
    ctx.view.value = ctx.viewport;

    expect(ctx.readout.position.value).toStrictEqual({ lngLat: [118.8, 32], center: true });

    ctx.pointer.value = { x: 600, y: 200 };
    expect(lngLatOf(ctx.readout.position.value)).toStrictEqual(['119.80', '33.00']);
    expect(ctx.readout.position.value?.center).toBe(false);
  });

  it('鼠标不动、地图缩放或画布尺寸变化时，随投影修订号重新拾取', () => {
    using ctx = setup();
    ctx.view.value = ctx.viewport;
    ctx.pointer.value = { x: 600, y: 300 };
    expect(lngLatOf(ctx.readout.position.value)).toStrictEqual(['119.80', '32.00']);
    expect(ctx.readout.scale.value?.label).toBe('50 km');

    ctx.projection.degreesPerPixel = 0.001;
    ctx.projectionRevision.value++;

    expect(lngLatOf(ctx.readout.position.value)).toStrictEqual(['118.90', '32.00']);
    expect(ctx.readout.scale.value?.label).toBe('5 km');
  });

  it('拾取不到时比例尺和经纬度为 null', () => {
    using ctx = setup();
    ctx.projection.miss = true;
    ctx.view.value = ctx.viewport;
    ctx.pointer.value = { x: 600, y: 200 };

    expect(ctx.readout.scale.value).toBeNull();
    expect(ctx.readout.position.value).toBeNull();
  });
});
