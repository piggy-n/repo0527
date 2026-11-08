import 'cesium/Build/Cesium/Widgets/CesiumWidget/CesiumWidget.css';
import type { PreparedTile, PreparedTileset } from '@mx/map-core';
import {
  Cartesian3,
  Cesium3DTileset,
  CesiumWidget,
  Math as CesiumMath,
  Matrix4,
  PerspectiveFrustum,
  type Scene,
  Transforms
} from 'cesium';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setCesiumBaseUrl } from './runtime';
import { memoryAdjustedError, SceneTilesets } from './scene-tilesets';

// 真实的 Cesium、按需渲染（和 CesiumScene 的设置相同）：显存预算压到几 MB，复现超出预算时的屏幕误差调整

const disposables: Disposable[] = [];
const objectUrls: string[] = [];

beforeAll(() => {
  setCesiumBaseUrl('/cesium/');
});

afterEach(() => {
  disposables
    .splice(0)
    .toReversed()
    .forEach(disposable => disposable[Symbol.dispose]());
  objectUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
});

const WIDTH = 960;
const HEIGHT = 640;

function createWidget(): CesiumWidget {
  const container = document.createElement('div');
  container.style.cssText = `position: absolute; left: 0; top: 0; width: ${WIDTH}px; height: ${HEIGHT}px`;
  document.body.append(container);
  const widget = new CesiumWidget(container, {
    baseLayer: false,
    skyBox: false,
    skyAtmosphere: false,
    requestRenderMode: true,
    maximumRenderTimeChange: Number.POSITIVE_INFINITY,
    creditContainer: document.createElement('div')
  });
  // 只看瓦片集：不画地球，软件渲染下每帧快一些
  widget.scene.globe.show = false;
  disposables.push({
    [Symbol.dispose]: () => {
      widget.destroy();
      container.remove();
    }
  });
  return widget;
}

// GLB 的块按 4 字节对齐要补的字节数
const glbPadding = (length: number) => (4 - (length % 4)) % 4;

// 不受光照的网格（glTF 2.0 的 GLB，y 朝上），显存约等于两个缓冲区的大小
function meshGlb(positions: Float32Array, indices: Uint16Array): Blob {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  positions.forEach((value, index) => {
    const axis = index % 3;
    min[axis] = Math.min(min[axis] ?? value, value);
    max[axis] = Math.max(max[axis] ?? value, value);
  });
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
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength, target: 34963 }
    ],
    buffers: [{ byteLength: positions.byteLength + indices.byteLength }]
  };
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonChunk = new Uint8Array(json.length + glbPadding(json.length)).fill(0x20);
  jsonChunk.set(json);
  const binLength = positions.byteLength + indices.byteLength;
  const binChunk = new Uint8Array(binLength + glbPadding(binLength));
  binChunk.set(new Uint8Array(positions.buffer), 0);
  binChunk.set(new Uint8Array(indices.buffer), positions.byteLength);
  const view = new DataView(new ArrayBuffer(12 + 8 + jsonChunk.length + 8 + binChunk.length));
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, view.byteLength, true);
  view.setUint32(12, jsonChunk.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(view.buffer).set(jsonChunk, 20);
  const binStart = 20 + jsonChunk.length;
  view.setUint32(binStart, binChunk.length, true);
  view.setUint32(binStart + 4, 0x004e4942, true);
  new Uint8Array(view.buffer).set(binChunk, binStart + 8);
  return new Blob([view.buffer], { type: 'model/gltf-binary' });
}

// 铺在 size × size 米地面上的 count 个小三角形，东北天的 (x, y, 1) 写成 y 朝上的 (x, 1, -y)
function groundGlb(size: number, count: number): Blob {
  const side = Math.ceil(Math.sqrt(count));
  const step = size / side;
  const positions = new Float32Array(count * 9);
  const indices = new Uint16Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = -size / 2 + (i % side) * step;
    const y = -size / 2 + Math.floor(i / side) * step;
    positions.set([x, 1, -y, x + step / 2, 1, -y, x, 1, -(y + step / 2)], i * 9);
    indices.set([i * 3, i * 3 + 1, i * 3 + 2], i * 3);
  }
  return meshGlb(positions, indices);
}

function urlOf(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  return url;
}

const MODEL_AT: [number, number] = [120.66, 31.31];
// 块和叶节点的边长（米）、块的误差（米）；4 × 4 个块，每块 2 × 2 个叶节点，瓦片厚 10 米
const BLOCK = 50;
const LEAF = BLOCK / 2;
const BLOCK_ERROR = 8;
const THICKNESS = 10;
// 第 i 个块抬高 i × 12 米：俯视时各块远近不同，需要的显存随屏幕误差一级一级变化，和真实的视野一样
const STEP = 12;
const TOP = 15 * STEP + THICKNESS;
// 叶节点约 172 KB，64 个约 11 MB；块的内容只有几百字节
const LEAF_TRIANGLES = 4096;
// 缓存 1 MB、溢出 2 MB：上限约是 4 块的叶节点
const CACHE_BYTES = 1024 * 1024;
const OVERFLOW_BYTES = 2 * 1024 * 1024;

const translation = (x: number, y: number, z = 0) => Matrix4.toArray(Matrix4.fromTranslation(new Cartesian3(x, y, z)));
const box = (size: number, height = THICKNESS) => ({
  box: [0, 0, height / 2, size / 2, 0, 0, 0, size / 2, 0, 0, 0, height / 2]
});

// 和 JKQ2 一样：根节点没有内容，下面直接是各块的根；块按 REPLACE 细分成叶节点。step 为 0 时各块一样高（俯视平地），
// blockTriangles 决定块的根有多重
function blocksTileset(rootError: number, step = STEP, blockTriangles = 4): PreparedTileset {
  const leafUrl = urlOf(groundGlb(LEAF, LEAF_TRIANGLES));
  const blockUrl = urlOf(groundGlb(BLOCK, blockTriangles));
  const blocks: PreparedTile[] = [];
  for (let index = 0; index < 16; index++) {
    const leaves: PreparedTile[] = [-1, 1].flatMap(dy =>
      [-1, 1].map(dx => ({
        transform: translation((dx * LEAF) / 2, (dy * LEAF) / 2),
        boundingVolume: box(LEAF),
        geometricError: 0,
        content: { uri: leafUrl }
      }))
    );
    blocks.push({
      transform: translation(((index % 4) - 1.5) * BLOCK, (Math.floor(index / 4) - 1.5) * BLOCK, index * step),
      boundingVolume: box(BLOCK),
      geometricError: BLOCK_ERROR,
      content: { uri: blockUrl },
      children: leaves
    });
  }
  const transform = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(...MODEL_AT, 0));
  return {
    asset: { version: '1.1' },
    geometricError: rootError,
    root: {
      transform: Matrix4.toArray(transform),
      boundingVolume: box(BLOCK * 4, 15 * step + THICKNESS),
      geometricError: rootError,
      refine: 'REPLACE',
      children: blocks
    }
  };
}

// 和超时赛跑：等不到时以 'timeout' 结束，断言给出原因，用例不会挂起
function within<T>(promise: Promise<T>, timeout: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), timeout);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

// 场景里建好的那个瓦片集：预算由测试压低
function findTileset(scene: Scene): Cesium3DTileset {
  for (let index = 0; index < scene.primitives.length; index++) {
    const primitive: unknown = scene.primitives.get(index);
    if (primitive instanceof Cesium3DTileset) {
      return primitive;
    }
  }
  throw new Error('场景里没有瓦片集');
}

// 按 tick 等条件：postUpdate 每个 tick 都触发，渲染与否都是
function ticker(scene: Scene) {
  let ticks = 0;
  const checks = new Set<() => void>();
  const stop = scene.postUpdate.addEventListener(() => {
    ticks++;
    checks.forEach(check => check());
  });
  const until = (check: () => boolean) =>
    new Promise<void>(resolve => {
      const listener = () => {
        if (check()) {
          checks.delete(listener);
          resolve();
        }
      };
      checks.add(listener);
    });
  const after = (count: number) => {
    const start = ticks;
    return until(() => ticks - start >= count);
  };
  return { until, after, stop };
}

describe('SceneTilesets 的显存预算', () => {
  it('按需渲染下超出预算：屏幕误差不越过没有内容的根节点、每一帧都有瓦片，稳定后不再变，停很久再画也有', async () => {
    const widget = createWidget();
    const { scene, camera } = widget;
    const failures: unknown[] = [];
    const tilesets = new SceneTilesets(widget, { failed: (_id, error) => failures.push(error), initial: () => {} });
    disposables.push(tilesets);

    const rootError = 35;
    const options = { show: true, lighting: 'sun' } as const;
    await tilesets.add('blocks', blocksTileset(rootError), options, new AbortController().signal);
    // 预算由测试压低：从场景里取出建好的瓦片集
    let tileset: Cesium3DTileset | undefined;
    for (let index = 0; index < scene.primitives.length; index++) {
      const primitive: unknown = scene.primitives.get(index);
      if (primitive instanceof Cesium3DTileset) {
        tileset = primitive;
      }
    }
    if (!tileset) {
      throw new Error('场景里没有瓦片集');
    }
    tileset.cacheBytes = CACHE_BYTES;
    tileset.maximumCacheOverflowBytes = OVERFLOW_BYTES;
    // 俯视，相机高 360 米：各块的屏幕误差约 19～39，在 16 时全部要细分（约 11 MB）。
    // 用正北朝上的正俯视：裸的 CesiumWidget 没有撤销相机的舍入漂移（holdCameraSteady），斜着时没动也会隔几个 tick 重画一帧，掩盖按需渲染下的问题
    const height = 360;
    camera.setView({
      destination: Cartesian3.fromDegrees(...MODEL_AT, height),
      orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 }
    });
    const { fovy } = camera.frustum instanceof PerspectiveFrustum ? camera.frustum : { fovy: undefined };
    if (fovy === undefined) {
      throw new Error('相机不是透视投影');
    }
    // 屏幕误差 = 几何误差 × 画布高 / (到包围盒的距离 × 2 tan(竖直视场角 / 2))；根节点最近的是正下方的顶面
    const rootSse = (rootError * HEIGHT) / ((height - TOP) * 2 * Math.tan(fovy / 2));
    expect(rootSse).toBeGreaterThan(120);

    let visible = 0;
    let shown = false;
    let emptyFrames = 0;
    let ticks = 0;
    let maxError = 0;
    let lastError = memoryAdjustedError(tileset);
    let ticksSinceChange = 0;
    const frames: number[] = [];
    disposables.push({ [Symbol.dispose]: tileset.tileVisible.addEventListener(() => visible++) });
    disposables.push({
      [Symbol.dispose]: scene.postRender.addEventListener(() => {
        shown ||= visible > 0;
        if (shown && visible === 0) {
          emptyFrames++;
        }
        frames.push(visible);
        visible = 0;
      })
    });
    const checks = new Set<() => void>();
    disposables.push({
      [Symbol.dispose]: scene.postUpdate.addEventListener(() => {
        ticks++;
        const error = memoryAdjustedError(tileset);
        ticksSinceChange = error === lastError ? ticksSinceChange + 1 : 0;
        lastError = error;
        maxError = Math.max(maxError, error);
        checks.forEach(check => check());
      })
    });
    // 每个 tick 检查一次（postUpdate 每个 tick 都触发，渲染与否都是），条件成立时结束
    const until = (check: () => boolean) =>
      new Promise<void>(resolve => {
        const listener = () => {
          if (check()) {
            checks.delete(listener);
            resolve();
          }
        };
        checks.add(listener);
      });
    const after = (count: number) => {
      const start = ticks;
      return until(() => ticks - start >= count);
    };

    // 先确认这个场景确实超出了预算：Cesium 开始放大屏幕误差
    const exceeded = until(() => memoryAdjustedError(tileset) > tileset.maximumScreenSpaceError);
    expect(await within(exceeded, 15000)).not.toBe('timeout');
    // 屏幕误差稳定下来：连续 60 个 tick 不变，之后不再为它请求渲染
    const settled = await within(until(() => ticksSinceChange >= 60), 30000);
    // 相机不动再过 200 个 tick：只在不渲染的 tick 里放大的话，屏幕误差会涨到约 50 倍
    expect(await within(after(200), 20000)).not.toBe('timeout');
    // 像用户动了一下相机那样再画一帧
    const rendered = frames.length;
    scene.requestRender();
    expect(await within(until(() => frames.length > rendered), 5000)).not.toBe('timeout');

    expect(failures).toEqual([]);
    expect(maxError).toBeLessThan(rootSse);
    expect(emptyFrames).toBe(0);
    expect(frames.at(-1)).toBeGreaterThan(0);
    expect(settled).not.toBe('timeout');
  }, 90000);

  it('俯视平地、各块一样远时放不下的一级被整级丢掉：定了地板后停在能放下的最细一级，不再反复加载和卸载', async () => {
    const widget = createWidget();
    const { scene, camera } = widget;
    const failures: unknown[] = [];
    const tilesets = new SceneTilesets(widget, { failed: (_id, error) => failures.push(error), initial: () => {} });
    disposables.push(tilesets);
    await tilesets.add('flat', blocksTileset(35, 0), { show: true, lighting: 'sun' }, new AbortController().signal);
    const tileset = findTileset(scene);
    tileset.cacheBytes = CACHE_BYTES;
    tileset.maximumCacheOverflowBytes = OVERFLOW_BYTES;
    // 俯视，相机高 360 米：16 个块离相机一样远，屏幕误差约 19，在 16 时全部要细分（约 11 MB），放不下；
    // 没有地板时 Cesium 涨过 19 整级丢掉叶节点、显存归零、又降回 16 重新加载，如此循环
    camera.setView({
      destination: Cartesian3.fromDegrees(...MODEL_AT, 360),
      orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 }
    });
    const { until, after, stop } = ticker(scene);
    disposables.push({ [Symbol.dispose]: stop });
    let decreases = 0;
    let lastError = memoryAdjustedError(tileset);
    let ticksSinceChange = 0;
    let visible = 0;
    let lastFrameVisible = 0;
    let frames = 0;
    disposables.push({ [Symbol.dispose]: tileset.tileVisible.addEventListener(() => visible++) });
    disposables.push({
      [Symbol.dispose]: scene.postRender.addEventListener(() => {
        frames++;
        lastFrameVisible = visible;
        visible = 0;
      })
    });
    disposables.push({
      [Symbol.dispose]: scene.postUpdate.addEventListener(() => {
        const error = memoryAdjustedError(tileset);
        if (error < lastError) {
          decreases++;
        }
        ticksSinceChange = error === lastError ? ticksSinceChange + 1 : 0;
        lastError = error;
      })
    });

    expect(await within(until(() => memoryAdjustedError(tileset) > 16), 15000)).not.toBe('timeout');
    expect(await within(until(() => ticksSinceChange >= 60), 30000)).not.toBe('timeout');
    const [settled] = tilesets.inspect();
    expect(settled?.screenSpaceErrorFloor).toBeGreaterThan(16);
    expect(settled?.memoryAdjustedScreenSpaceError).toBe(settled?.screenSpaceErrorFloor);
    // 再过 300 个 tick：没有新的加载和卸载，误差也不变
    expect(await within(after(300), 30000)).not.toBe('timeout');
    const [later] = tilesets.inspect();
    expect(later?.loaded).toBe(settled?.loaded);
    expect(later?.unloaded).toBe(settled?.unloaded);
    expect(later?.memoryAdjustedScreenSpaceError).toBe(settled?.memoryAdjustedScreenSpaceError);
    // 地板定下之前最多回落一次
    expect(decreases).toBeLessThanOrEqual(1);
    // 像用户动了一下相机那样再画一帧：画得出瓦片（块的根）
    const rendered = frames;
    scene.requestRender();
    expect(await within(until(() => frames > rendered), 5000)).not.toBe('timeout');
    expect(lastFrameVisible).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  }, 90000);

  it('连块的根都放不下时（根节点没有内容的 JKQ2 在远处）：误差压在根节点以下，已加载的块继续画、不整个消失', async () => {
    const widget = createWidget();
    const { scene, camera } = widget;
    const failures: unknown[] = [];
    const tilesets = new SceneTilesets(widget, { failed: (_id, error) => failures.push(error), initial: () => {} });
    disposables.push(tilesets);
    // 块的根和叶节点一样重（约 172 KB），16 个块约 2.7 MB；预算 1 MB + 0.5 MB 连根都放不下
    const rootError = 35;
    await tilesets.add(
      'heavy',
      blocksTileset(rootError, 0, LEAF_TRIANGLES),
      { show: true, lighting: 'sun' },
      new AbortController().signal
    );
    const tileset = findTileset(scene);
    tileset.cacheBytes = CACHE_BYTES;
    tileset.maximumCacheOverflowBytes = CACHE_BYTES / 2;
    camera.setView({
      destination: Cartesian3.fromDegrees(...MODEL_AT, 360),
      orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 }
    });
    const { fovy } = camera.frustum instanceof PerspectiveFrustum ? camera.frustum : { fovy: undefined };
    if (fovy === undefined) {
      throw new Error('相机不是透视投影');
    }
    // 根节点的屏幕误差：到包围盒顶面的距离
    const rootSse = (rootError * HEIGHT) / ((360 - THICKNESS) * 2 * Math.tan(fovy / 2));
    const { until, after, stop } = ticker(scene);
    disposables.push({ [Symbol.dispose]: stop });
    let visible = 0;
    let lastFrameVisible = 0;
    let frames = 0;
    disposables.push({ [Symbol.dispose]: tileset.tileVisible.addEventListener(() => visible++) });
    disposables.push({
      [Symbol.dispose]: scene.postRender.addEventListener(() => {
        frames++;
        lastFrameVisible = visible;
        visible = 0;
      })
    });

    // Cesium 开始放大以后再过 300 个 tick：没有压住的话它会涨过根节点、整树不画
    expect(await within(until(() => memoryAdjustedError(tileset) > 16), 15000)).not.toBe('timeout');
    expect(await within(after(300), 30000)).not.toBe('timeout');
    const [inspection] = tilesets.inspect();
    expect(inspection?.memoryAdjustedScreenSpaceError).toBeLessThan(rootSse);
    expect(inspection?.memoryAdjustedScreenSpaceError).toBeGreaterThan(16);
    expect(inspection?.statistics.selected).toBeGreaterThan(0);
    // 清晰度：画的是块的根（误差 8），贴图没有，密度为 0
    expect(inspection?.selection?.count).toBeGreaterThan(0);
    expect(inspection?.selection?.coarsestError).toBe(BLOCK_ERROR);
    const rendered = frames;
    scene.requestRender();
    expect(await within(until(() => frames > rendered), 5000)).not.toBe('timeout');
    expect(lastFrameVisible).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  }, 90000);
});
