import 'cesium/Build/Cesium/Widgets/CesiumWidget/CesiumWidget.css';
import type { CameraState } from '@yzt/map-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CesiumScene } from './cesium-scene';
import { setCesiumBaseUrl } from './runtime';
import type { ImageryPlan } from './scene-style';

// 真实的 Cesium（ADR 0040、0079 第 3 节）：只用本地地址，不请求天地图；每个用例自己创建容器和场景，结束时释放

const scenes: CesiumScene[] = [];
const containers: HTMLElement[] = [];

beforeAll(() => {
  // 和 app 的运行时一样：Worker、资源由 vite.config.ts 复制到 /cesium/
  setCesiumBaseUrl('/cesium/');
});

afterEach(() => {
  scenes.splice(0).forEach(scene => scene[Symbol.dispose]());
  containers.splice(0).forEach(container => container.remove());
});

function createScene(width = 960, height = 640): CesiumScene {
  const container = document.createElement('div');
  container.style.cssText = `position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px`;
  document.body.append(container);
  containers.push(container);
  const scene = new CesiumScene(container);
  scenes.push(scene);
  return scene;
}

// 本地不存在的瓦片：请求在本机失败，用来检查错误报告
const missing = (id: string, extra: Partial<ImageryPlan> = {}): ImageryPlan => ({
  id,
  sourceId: `${id}-source`,
  url: `${window.location.origin}/__missing__/${id}/{z}/{x}/{y}.png`,
  subdomains: [],
  tileSize: 256,
  minimumLevel: 0,
  maximumLevel: 18,
  opacity: 1,
  show: true,
  ...extra
});

describe('CesiumScene', () => {
  it('相机的写入和读回互逆：中心、缩放级、方位、俯角都还原，正俯视时方位不丢', () => {
    const scene = createScene();
    const cameras: CameraState[] = [
      { center: [119.5, 33], zoom: 6.8, bearing: 0, pitch: 0 },
      { center: [118.78, 32.04], zoom: 13.2, bearing: 135, pitch: 0 },
      { center: [120.62, 31.31], zoom: 15, bearing: 30, pitch: 45 },
      { center: [117.28, 34.22], zoom: 10.5, bearing: 300, pitch: 60 }
    ];

    for (const camera of cameras) {
      scene.jumpTo(camera);
      const read = scene.readCamera();
      expect(read?.center[0]).toBeCloseTo(camera.center[0], 6);
      expect(read?.center[1]).toBeCloseTo(camera.center[1], 6);
      expect(read?.zoom).toBeCloseTo(camera.zoom, 6);
      expect(read?.bearing).toBeCloseTo(camera.bearing, 3);
      expect(read?.pitch).toBeCloseTo(camera.pitch, 3);
    }
  });

  it('拾取画布中心打到椭球上的中心点；俯角很大时看向天空的地方是 miss', () => {
    const scene = createScene();
    scene.jumpTo({ center: [119, 32], zoom: 12, bearing: 0, pitch: 0 });

    const center = scene.pick({ x: 480, y: 320 });
    expect(center).toMatchObject({ kind: 'hit', surface: 'ellipsoid' });
    const [lng, lat] = center.kind === 'hit' ? center.lngLat : [Number.NaN, Number.NaN];
    expect(lng).toBeCloseTo(119, 5);
    expect(lat).toBeCloseTo(32, 5);

    scene.jumpTo({ center: [119, 32], zoom: 16, bearing: 0, pitch: 85 });
    expect(scene.pick({ x: 480, y: 2 })).toStrictEqual({ kind: 'miss' });
  });

  it('投影：中心点在画布中央，地球背面的点为 null', () => {
    const scene = createScene();
    scene.jumpTo({ center: [119, 32], zoom: 8, bearing: 0, pitch: 0 });

    const point = scene.project([119, 32]);
    expect(point?.x).toBeCloseTo(480, 1);
    expect(point?.y).toBeCloseTo(320, 1);
    expect(scene.project([-61, -32])).toBeNull();
  });

  it('画布的尺寸就是容器的 CSS 尺寸', () => {
    const scene = createScene(720, 480);

    expect(scene.size()).toStrictEqual({ width: 720, height: 480 });
  });

  it('影像图层按 ID 增删改：同一来源只改透明度和显隐，换了地址就换图层；瓦片失败按数据源报告', async () => {
    const scene = createScene();
    scene.jumpTo({ center: [119, 32], zoom: 6, bearing: 0, pitch: 0 });
    const errors: string[] = [];
    let reported: (() => void) | undefined;
    const firstError = new Promise<void>(resolve => (reported = resolve));
    scene.on('imageryerror', sourceId => {
      errors.push(sourceId);
      reported?.();
    });

    scene.setImagery([missing('base'), missing('labels', { opacity: 0.5 })]);
    scene.setImagery([missing('base', { opacity: 0.3, show: false })]);
    scene.setImagery([missing('base', { url: `${window.location.origin}/__missing__/other/{z}/{x}/{y}.png` })]);

    const timeout = new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 15000));
    await expect(Promise.race([firstError.then(() => 'reported' as const), timeout])).resolves.toBe('reported');
    expect(new Set(errors)).toStrictEqual(new Set(['base-source']));
  });
});
