import 'cesium/Build/Cesium/Widgets/CesiumWidget/CesiumWidget.css';
import type { CameraState } from '@yzt/map-core';
import type { GeoJSON, Position } from 'geojson';
import { Cartesian3, Matrix4, Transforms } from 'cesium';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MAPLIBRE_FOVY, zoomToDistance } from './camera-math';
import { CesiumScene } from './cesium-scene';
import { type OverlayLayerSpecification, planOverlays } from './overlay-plan';
import type { PreparedTileset } from './prepare-tileset';
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

function createScene(width = 960, height = 640, preserveDrawingBuffer = false): CesiumScene {
  const container = document.createElement('div');
  container.style.cssText = `position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px`;
  document.body.append(container);
  containers.push(container);
  const scene = new CesiumScene(container, { preserveDrawingBuffer });
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

type Rgb = readonly [number, number, number];

// 读画布上某个经纬度处的颜色；场景要用 preserveDrawingBuffer 创建
function colorAt(scene: CesiumScene, lngLat: [number, number]): Rgb | null {
  const canvas = containers.at(-1)?.querySelector('canvas');
  const point = scene.project(lngLat);
  if (!canvas || !point) {
    return null;
  }
  const probe = document.createElement('canvas');
  probe.width = canvas.width;
  probe.height = canvas.height;
  const context = probe.getContext('2d');
  if (!context) {
    return null;
  }
  context.drawImage(canvas, 0, 0);
  const ratio = canvas.width / canvas.clientWidth;
  const pixel = context.getImageData(Math.round(point.x * ratio), Math.round(point.y * ratio), 1, 1);
  const [r = 0, g = 0, b = 0] = pixel.data;
  return [r, g, b];
}

const near = (actual: Rgb | null, expected: Rgb) =>
  actual !== null && actual.every((value, index) => Math.abs(value - (expected[index] ?? 0)) <= 24);

// 每一帧检查一次，条件成立或超时结束；结束后不再检查。超时要比用例的时限短，画不出来时以断言失败
async function waitForFrames(check: () => boolean, timeout = 10000): Promise<'ok' | 'timeout'> {
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const satisfied = new Promise<'ok'>(resolve => {
    const poll = () => {
      if (check()) {
        resolve('ok');
        return;
      }
      frame = requestAnimationFrame(poll);
    };
    poll();
  });
  const expired = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), timeout);
  });
  try {
    return await Promise.race([satisfied, expired]);
  } finally {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  }
}

// 接下来的 count 帧里每帧检查一次，给出不满足的帧数
function failingFrames(count: number, check: () => boolean): Promise<number> {
  return new Promise(resolve => {
    let failing = 0;
    let remaining = count;
    const step = () => {
      if (!check()) {
        failing++;
      }
      remaining--;
      if (remaining === 0) {
        resolve(failing);
      } else {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  });
}

const WORLD: Position[] = [
  [-180, -85.051129],
  [180, -85.051129],
  [180, 85.051129],
  [-180, 85.051129],
  [-180, -85.051129]
];

const HOLE: Position[] = [
  [118.5, 31.6],
  [119.5, 31.6],
  [119.5, 32.4],
  [118.5, 32.4],
  [118.5, 31.6]
];

const overlayLayers = (lineWidth: number): OverlayLayerSpecification[] => [
  { id: 'mask', type: 'fill', source: 'mask', paint: { 'fill-color': '#ff0000' } },
  { id: 'line', type: 'line', source: 'line', paint: { 'line-color': '#0000ff', 'line-width': lineWidth } },
  { id: 'point', type: 'circle', source: 'point', paint: { 'circle-color': '#00ff00', 'circle-radius': 10 } }
];

// 用和视图相同的推导得到形状：遮罩的外环是整个世界，线带相邻的重复点
function overlayData(lineLatitude: number): Record<string, GeoJSON> {
  return {
    mask: { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[WORLD, HOLE]] } },
    line: {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [118, lineLatitude],
          [118, lineLatitude],
          [120, lineLatitude]
        ]
      }
    },
    point: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [119, 32] } }
  };
}

function planLayers(lineLatitude: number, lineWidth = 8) {
  const data = overlayData(lineLatitude);
  return planOverlays(
    overlayLayers(lineWidth).map((layer, order) => ({
      layer,
      order,
      sourceId: layer.source,
      data: data[layer.source] ?? ''
    })),
    ({ sourceId }) => data[sourceId],
    8
  );
}

// GLB 的块按 4 字节对齐要补的字节数
const glbPadding = (length: number) => (4 - (length % 4)) % 4;

// 一个红色、不受光照的立方体（glTF 2.0 的 GLB），边长 2 × half 米
function boxGlb(half: number): Blob {
  const h = half;
  const positions = new Float32Array([
    // z = -h 的四个角
    -h, -h, -h, h, -h, -h, h, h, -h, -h, h, -h,
    // z = h 的四个角
    -h, -h, h, h, -h, h, h, h, h, -h, h, h
  ]);
  const indices = new Uint16Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3
  ]);
  const gltf = {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_materials_unlit'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], metallicFactor: 0 },
        extensions: { KHR_materials_unlit: {} }
      }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-h, -h, -h], max: [h, h, h] },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength, target: 34963 }
    ],
    buffers: [{ byteLength: positions.byteLength + indices.byteLength }]
  };
  // 两个块都要按 4 字节对齐：JSON 补空格，二进制补 0
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonChunk = new Uint8Array(json.length + glbPadding(json.length)).fill(0x20);
  jsonChunk.set(json);
  const binLength = positions.byteLength + indices.byteLength;
  const binChunk = new Uint8Array(binLength + glbPadding(binLength));
  binChunk.set(new Uint8Array(positions.buffer), 0);
  binChunk.set(new Uint8Array(indices.buffer), positions.byteLength);
  const header = new DataView(new ArrayBuffer(12 + 8 + jsonChunk.length + 8 + binChunk.length));
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, header.byteLength, true);
  header.setUint32(12, jsonChunk.length, true);
  header.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(header.buffer).set(jsonChunk, 20);
  const binStart = 20 + jsonChunk.length;
  header.setUint32(binStart, binChunk.length, true);
  header.setUint32(binStart + 4, 0x004e4942, true);
  new Uint8Array(header.buffer).set(binChunk, binStart + 8);
  return new Blob([header.buffer], { type: 'model/gltf-binary' });
}

const MODEL_AT: [number, number] = [120.66, 31.31];
const objectUrls: string[] = [];

// 只有一个瓦片的瓦片集：立方体放在 MODEL_AT 的地面上；contentUri 不传时用本地生成的立方体
function boxTileset(contentUri?: string): PreparedTileset {
  const url = contentUri ?? URL.createObjectURL(boxGlb(40));
  objectUrls.push(url);
  const transform = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(...MODEL_AT, 0));
  return {
    asset: { version: '1.1' },
    geometricError: 100,
    root: {
      transform: Matrix4.toArray(transform),
      boundingVolume: { sphere: [0, 0, 0, 70] },
      geometricError: 0,
      refine: 'ADD',
      content: { uri: url }
    }
  };
}

afterEach(() => {
  objectUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
});

// 下一次触发某个事件；和超时赛跑，结束后退订
function nextEvent(scene: CesiumScene, event: 'tilesetfailed' | 'tilesetinitial', timeout = 10000) {
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fired = new Promise<string>(resolve => {
    unsubscribe = scene.on(event, (id: string) => resolve(id));
  });
  const expired = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), timeout);
  });
  return Promise.race([fired, expired]).finally(() => {
    unsubscribe?.();
    clearTimeout(timer);
  });
}

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

  it('临时拖动：from 处的地面点转到 to 下面，倾斜、旋转时也一样；指向天空时不动（ADR 0080 第 4 节）', () => {
    // 容器在页面左上角，客户区坐标就是画布坐标
    const scene = createScene();
    const from = { x: 400, y: 300 };
    const to = { x: 520, y: 360 };
    const cameras: CameraState[] = [
      { center: [119, 32], zoom: 9, bearing: 0, pitch: 0 },
      { center: [120.6, 31.3], zoom: 12, bearing: 30, pitch: 50 }
    ];

    for (const camera of cameras) {
      scene.jumpTo(camera);
      const grabbed = scene.pick(from);
      expect(grabbed.kind).toBe('hit');
      scene.panBetween(from, to);

      // 抓住的地面点现在投影在 to 上，不到半个像素
      const landed = grabbed.kind === 'hit' ? scene.project(grabbed.lngLat) : null;
      expect(Math.hypot((landed?.x ?? Number.NaN) - to.x, (landed?.y ?? Number.NaN) - to.y)).toBeLessThan(0.5);
    }

    scene.jumpTo({ center: [119, 32], zoom: 16, bearing: 0, pitch: 85 });
    const before = scene.readCamera();
    scene.panBetween({ x: 480, y: 2 }, { x: 480, y: 300 });
    expect(scene.readCamera()).toStrictEqual(before);
  });

  it('视点高度：正俯视时等于按缩放级换算的相机距离（ADR 0080 第 6 节）', () => {
    const scene = createScene();
    scene.jumpTo({ center: [119, 32], zoom: 8, bearing: 0, pitch: 0 });

    const expected = zoomToDistance(8, 32, 640, MAPLIBRE_FOVY);
    expect(Math.abs(scene.eyeHeight() - expected) / expected).toBeLessThan(0.001);
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
  it('覆盖物画在地球上：遮罩盖住洞外、洞里露出地球，线在遮罩上面，点在最上面；整个世界的遮罩不让渲染停下', async () => {
    const scene = createScene(960, 640, true);
    const failures: unknown[] = [];
    scene.on('failure', error => failures.push(error));
    scene.jumpTo({ center: [119, 32], zoom: 8, bearing: 0, pitch: 0 });

    scene.setOverlays(planLayers(32.6));

    const drawn = await waitForFrames(
      () =>
        near(colorAt(scene, [118.2, 31.3]), [255, 0, 0]) &&
        near(colorAt(scene, [119.3, 31.8]), [0xdf, 0xe7, 0xf2]) &&
        near(colorAt(scene, [119, 32.6]), [0, 0, 255]) &&
        near(colorAt(scene, [119, 32]), [0, 255, 0])
    );
    expect(drawn).toBe('ok');
    expect(failures).toStrictEqual([]);
  }, 30000);

  it('样式变了要重建：旧的线留到新的画好，重建期间每一帧都看得到线（ADR 0080 第 1 节）', async () => {
    const scene = createScene(960, 640, true);
    scene.jumpTo({ center: [119, 32], zoom: 8, bearing: 0, pitch: 0 });
    scene.setOverlays(planLayers(32.6));
    await expect(waitForFrames(() => near(colorAt(scene, [119, 32.6]), [0, 0, 255]))).resolves.toBe('ok');

    scene.setOverlays(planLayers(32.6, 12));
    const gaps = await failingFrames(90, () => near(colorAt(scene, [119, 32.6]), [0, 0, 255]));

    expect(gaps).toBe(0);
  }, 30000);

  it('在相机变化的回调里重建（跨级重新推导就是这样）：换过坐标的线同样留到新的画好', async () => {
    const scene = createScene(960, 640, true);
    scene.jumpTo({ center: [119, 32], zoom: 8, bearing: 0, pitch: 0 });
    scene.setOverlays(planLayers(32.6));
    await expect(waitForFrames(() => near(colorAt(scene, [119, 32.6]), [0, 0, 255]))).resolves.toBe('ok');
    // 只换坐标：线改成每帧读取，不再在 Cesium 的静态批次里（静态批次自己会把旧的留到新的建好）
    scene.setOverlays(planLayers(31.3));
    await expect(waitForFrames(() => near(colorAt(scene, [119, 31.3]), [0, 0, 255]))).resolves.toBe('ok');

    let rebuilt = false;
    const unsubscribe = scene.on('camerachange', () => {
      if (!rebuilt) {
        rebuilt = true;
        scene.setOverlays(planLayers(31.3, 12));
      }
    });
    scene.jumpTo({ center: [119.02, 32], zoom: 8, bearing: 0, pitch: 0 });
    const gaps = await failingFrames(90, () => near(colorAt(scene, [119, 31.3]), [0, 0, 255]));
    unsubscribe();

    expect(rebuilt).toBe(true);
    expect(gaps).toBe(0);
  }, 30000);

  it('样式不变只改坐标：线移到新位置，原来的位置露出遮罩', async () => {
    const scene = createScene(960, 640, true);
    scene.jumpTo({ center: [119, 32], zoom: 8, bearing: 0, pitch: 0 });
    scene.setOverlays(planLayers(32.6));
    await expect(waitForFrames(() => near(colorAt(scene, [119, 32.6]), [0, 0, 255]))).resolves.toBe('ok');

    scene.setOverlays(planLayers(31.3));

    const moved = await waitForFrames(
      () => near(colorAt(scene, [119, 31.3]), [0, 0, 255]) && near(colorAt(scene, [119, 32.6]), [255, 0, 0])
    );
    expect(moved).toBe('ok');
  }, 30000);
  it('瓦片集建好后加进场景并画出来；给出的相机斜着看、让模型进入画布；首批瓦片到位时报告（ADR 0081）', async () => {
    const scene = createScene(960, 640, true);
    scene.jumpTo({ center: [119, 32], zoom: 8, bearing: 0, pitch: 0 });
    const initial = nextEvent(scene, 'tilesetinitial');

    const options = { show: true, lighting: 'sun' } as const;
    const camera = await scene.addTileset('box', boxTileset(), options, new AbortController().signal);
    expect(camera.center[0]).toBeCloseTo(MODEL_AT[0], 3);
    expect(camera.center[1]).toBeCloseTo(MODEL_AT[1], 3);
    expect(camera.pitch).toBe(55);

    scene.jumpTo(camera);
    await expect(initial).resolves.toBe('box');
    await expect(waitForFrames(() => near(colorAt(scene, MODEL_AT), [255, 0, 0]))).resolves.toBe('ok');

    scene.updateTileset('box', { show: false, lighting: 'sun' });
    await expect(waitForFrames(() => !near(colorAt(scene, MODEL_AT), [255, 0, 0]))).resolves.toBe('ok');
    scene.removeTileset('box');
  }, 30000);

  it('瓦片下载失败时报告；加进来之前中止的以中止的原因结束', async () => {
    const scene = createScene();
    scene.jumpTo({ center: MODEL_AT, zoom: 15, bearing: 0, pitch: 0 });
    const failed = nextEvent(scene, 'tilesetfailed');
    await scene.addTileset(
      'missing',
      boxTileset(`${window.location.origin}/__missing__/box.glb`),
      { show: true, lighting: 'sun' },
      new AbortController().signal
    );
    await expect(failed).resolves.toBe('missing');

    const controller = new AbortController();
    const adding = scene.addTileset('late', boxTileset(), { show: true, lighting: 'headlight' }, controller.signal);
    controller.abort(new DOMException('卸载了', 'AbortError'));
    await expect(adding).rejects.toThrow('卸载了');
  }, 30000);

  it('钻地：相机在地下时退出，先飞回地表上方（ADR 0081 第 6 节）', async () => {
    const scene = createScene();
    const options = { show: true, lighting: 'headlight' } as const;
    const camera = await scene.addTileset('box', boxTileset(), options, new AbortController().signal);
    scene.jumpTo(camera);
    scene.setUnderground({ tilesetId: 'box', surfaceOpacity: 0.25 });
    // 把相机放到地下 20 米
    const below = Cartesian3.fromDegrees(...MODEL_AT, -20);
    const pose = scene.savePose();
    scene.restorePose({ ...pose, position: [below.x, below.y, below.z] });
    expect(scene.eyeHeight()).toBeLessThan(0);

    scene.setUnderground(null);

    await expect(waitForFrames(() => scene.eyeHeight() > 100)).resolves.toBe('ok');
  }, 30000);
});
