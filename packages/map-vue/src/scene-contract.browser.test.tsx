import {
  buildNavigation,
  type CameraState,
  EMPTY_SCENE_CONTENT,
  type Navigation,
  prepareTileset,
  type RouteRoam,
  type SceneContent,
  type ScreenPoint,
  type SplatLayer,
  type StyleGroup,
  type TilesetLayer,
  type TilesetStatus,
  type WalkRoam
} from '@mx/map-core';
import { mount } from '@vue/test-utils';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';
import { commands } from 'vitest/browser';
import { defineComponent, effectScope, provide, shallowRef, watch } from 'vue';
import { MapCanvas } from './MapCanvas';
import { type MapHandle, provideMap } from './provide-map';
import { MAP_SCENE_ENGINE, MAPLIBRE_ENGINE, type SceneEngine } from './runtime';

// 三维的契约测试（ADR 0147 第 3 节）：用真实的 MapLibre + Three，和页面一样只通过 provideMap、bindScene、setDimension、
// 相机操作和上下文的状态使用地图。3C.1 覆盖三维内容的增删、状态、失败和重试，以及 GL 上下文的丢失和恢复；
// 3C.3 加上漫游的开始、暂停、退出；LCC2 高斯泼溅（ADR 0149）的加载、定位、拾取、移除。
// 以前同一组用例也跑 Cesium，ADR 0153 移除了它

// 夹具是提交在 src/testing/scene-fixtures 的文本文件，由测试的开发服务器提供：box 是边长 80 米的红色立方体（glTF，缓冲内嵌），
// 放在 [120.66, 31.31] 的地面上；broken 是同一个瓦片集，但瓦片的地址不存在
const MODEL_AT = [120.66, 31.31] as const;
const FIXTURES = `${window.location.origin}/src/testing/scene-fixtures`;
const CAMERA: CameraState = { center: [120.6, 31.3], zoom: 12, bearing: 0, pitch: 0 };
const BACKGROUND: StyleGroup = {
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#202020' } }]
};
// 软件渲染下三维模块的启动、瓦片的加载都慢：用例的时限放宽到 60 秒；可能一直等不到的条件和它赛跑
const TEST_TIMEOUT = 60000;
const WAIT_TIMEOUT = 45000;
const WIDTH = 640;
const HEIGHT = 480;

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

// 等一个可能一直不来的事件，超时以说明失败
async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${WAIT_TIMEOUT} ms 内没有等到${label}`)), WAIT_TIMEOUT);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}

// 每一帧检查一次，条件成立时结束；超时以说明失败，结束后不再检查
async function until(accept: () => boolean, label: string): Promise<void> {
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const satisfied = new Promise<void>(resolve => {
    const poll = () => {
      if (accept()) {
        resolve();
        return;
      }
      frame = requestAnimationFrame(poll);
    };
    poll();
  });
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${WAIT_TIMEOUT} ms 内没有等到${label}`)), WAIT_TIMEOUT);
  });
  try {
    await Promise.race([satisfied, expired]);
  } finally {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  }
}

const layer = (id: string, url: string, extra: Partial<TilesetLayer> = {}): TilesetLayer => ({
  id,
  url,
  show: true,
  lighting: 'sun',
  attempt: 0,
  ...extra
});

// 高斯泼溅的夹具（ADR 0149）：60 米见方、绿色的扁平高斯铺成的正方形，放在 MODEL_AT 的地面上。
// 库在自己的 Worker 里下载数据块、只读二进制的 PLY，所以在测试时生成、写到包里不入库的目录，由开发服务器提供
// （做法同 map-three 的 testing/lcc2-fixture；包的测试之间不互相导入）
const SPLAT_PROPERTIES = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2'];
const SPLAT_ROTATION = ['rot_0', 'rot_1', 'rot_2', 'rot_3'];

function splatSquarePly(size: number, count: number): Uint8Array {
  const properties = [...SPLAT_PROPERTIES, ...SPLAT_ROTATION];
  const header = new TextEncoder().encode(
    ['ply', 'format binary_little_endian 1.0', `element vertex ${count * count}`]
      .concat(properties.map(name => `property float ${name}`), ['end_header', ''])
      .join('\n')
  );
  const stride = properties.length * 4;
  const bytes = new Uint8Array(header.length + count * count * stride);
  bytes.set(header);
  const view = new DataView(bytes.buffer, header.length);
  const spacing = size / (count - 1);
  // 绿色：基础颜色 0.5 + 0.282 × f_dc
  const green = [-1.77, 1.77, -1.77];
  for (let i = 0; i < count * count; i++) {
    const x = (i % count) * spacing - size / 2;
    const y = Math.floor(i / count) * spacing - size / 2;
    const values = [x, y, 0, ...green, 6, Math.log(spacing * 0.75), Math.log(spacing * 0.75), Math.log(0.05), 1, 0, 0, 0];
    values.forEach((value, index) => view.setFloat32(i * stride + index * 4, value, true));
  }
  return bytes;
}

function splatSquareIndex(size: number, count: number): Uint8Array {
  const boundingBox = { min: [-size / 2, -size / 2, -0.2], max: [size / 2, size / 2, 0.2] };
  const data = { '3dgs': { name: 0, start: 0, count: count * count } };
  const index = {
    version: '0.0.3',
    totalLevels: 1,
    offset: [0, 0, 0],
    root: { id: '0', boundingBox, splatFiles: ['data/3dgs/0.ply'], child: { '0': { id: '0_0', boundingBox, data } } }
  };
  return new TextEncoder().encode(`\uFEFF${JSON.stringify(index)}`);
}

const toBase64 = (bytes: Uint8Array) => {
  let text = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(text);
};

// 每个文件写一份，第一次用到时写；文件跑完删掉写过的。afterAll 要在收集用例时登记，运行中登记的 Vitest 不执行
let splatUrl: Promise<string> | null = null;
const writtenFiles: string[] = [];
afterAll(async () => {
  await Promise.all(writtenFiles.splice(0).map(file => commands.removeFile(file)));
});

function writtenSplat(): Promise<string> {
  splatUrl ??= (async () => {
    const directory = 'node_modules/.tmp/splat-fixtures/contract';
    const files: [string, Uint8Array][] = [
      [`${directory}/square.lcc2`, splatSquareIndex(60, 21)],
      [`${directory}/data/3dgs/0.ply`, splatSquarePly(60, 21)]
    ];
    await Promise.all(files.map(([file, bytes]) => commands.writeFile(file, toBase64(bytes), 'base64')));
    writtenFiles.push(...files.map(([file]) => file));
    return `${window.location.origin}/${directory}/square.lcc2`;
  })();
  return splatUrl;
}

const splatLayer = (url: string, extra: Partial<SplatLayer> = {}): SplatLayer => ({
  id: 'square',
  url,
  show: true,
  placement: { lng: MODEL_AT[0], lat: MODEL_AT[1], height: 0, heading: 0 },
  attempt: 0,
  ...extra
});

type Group = 'basemap' | 'resources' | 'labels';

// 地面上以 MODEL_AT 为中心、半边长 half 度的方块
function square(id: string, half: number, color: string): StyleGroup {
  const [lng, lat] = MODEL_AT;
  const ring = [
    [lng - half, lat - half],
    [lng + half, lat - half],
    [lng + half, lat + half],
    [lng - half, lat + half],
    [lng - half, lat - half]
  ];
  return {
    sources: {
      [id]: {
        type: 'geojson',
        data: { type: 'Feature', properties: { id }, geometry: { type: 'Polygon', coordinates: [ring] } }
      }
    },
    layers: [{ id: `${id}-fill`, type: 'fill', source: id, paint: { 'fill-color': color } }]
  };
}

interface PageOptions {
  /** 三维引擎；默认是真实的 MapLibre 引擎 */
  readonly engine?: SceneEngine;
  /** 切到三维后等到就绪；三维模块加载失败的用例不等 */
  readonly waitReady?: boolean;
  /** 资源（被模型挡住）和注记（画在模型上面）分组，sceneBelow 是 labels */
  readonly resources?: StyleGroup;
  readonly labels?: StyleGroup;
}

// 页面：画布、底图、三维内容的推导函数；切到三维、等视图就绪。引擎像 app 一样由页面外面的一层提供
async function mountPage({ engine = MAPLIBRE_ENGINE, waitReady = true, resources, labels }: PageOptions = {}) {
  const content = shallowRef<SceneContent>(EMPTY_SCENE_CONTENT);
  const errors: unknown[] = [];
  let handle: MapHandle<Group> | undefined;
  const empty: StyleGroup = { sources: {}, layers: [] };
  const Page = defineComponent(() => {
    handle = provideMap({
      groups: ['basemap', 'resources', 'labels'],
      sceneBelow: 'labels',
      camera: CAMERA,
      onError: error => errors.push(error)
    });
    handle.bindStyle({ basemap: () => BACKGROUND, resources: () => resources ?? empty, labels: () => labels ?? empty });
    handle.bindScene(() => content.value);
    return () => (
      <div style={{ position: 'relative', width: `${WIDTH}px`, height: `${HEIGHT}px` }}>
        <MapCanvas
          mapOptions={{
            maxZoom: 24,
            centerClampedToGround: false,
            // 读像素要保留绘制缓冲
            canvasContextAttributes: { preserveDrawingBuffer: true, antialias: false }
          }}
        />
      </div>
    );
  });
  const Provider = defineComponent(() => {
    provide(MAP_SCENE_ENGINE, engine);
    return () => <Page />;
  });
  const wrapper = mount(Provider, { attachTo: document.body });
  onTestFinished(() => wrapper.unmount());
  const map = handle;
  if (!map) {
    throw new Error('没有创建地图句柄');
  }
  map.setDimension('3d');
  if (waitReady) {
    await until(() => map.viewState.value === 'ready', '三维视图就绪');
  }
  const stateOf = (id: string): TilesetStatus['state'] | undefined => map.sceneStatus.value.get(id)?.state;
  // 同步记下每一次状态变化：重试时的加载中可能只有几毫秒，不能靠轮询
  const history: string[] = [];
  const stop = watch(
    map.sceneStatus,
    status => history.push([...status].map(([id, { state }]) => `${id}:${state}`).join(' ')),
    { flush: 'sync' }
  );
  onTestFinished(stop);
  return { map, content, errors, stateOf, history };
}

type Page = Awaited<ReturnType<typeof mountPage>>;

// 就绪的视图；没有时抛出说明
function readyView(page: Page) {
  const view = page.map.view.value;
  if (!view) {
    throw new Error(`视图没有就绪：${page.map.viewState.value}`);
  }
  return view;
}

// 加上立方体瓦片集，按就绪时建议的相机定位，等到画布中心拾取到模型
async function locateBox(page: Page): Promise<void> {
  page.content.value = { tilesets: [layer('box', `${FIXTURES}/box/tileset.json`)], underground: null };
  await until(() => page.stateOf('box') === 'ready', '瓦片集就绪');
  const ready = page.map.sceneStatus.value.get('box');
  if (ready?.state !== 'ready') {
    throw new Error('瓦片集没有就绪');
  }
  page.map.runCameraOperation(camera => camera.flyTo(ready.camera, { duration: 0, padding: 0 }));
  await until(() => {
    const hit = page.map.view.value?.pick({ x: WIDTH / 2, y: HEIGHT / 2 });
    return hit?.kind === 'hit' && hit.surface === 'model';
  }, '画布中心拾取到模型');
}

// 在组件外订阅会话的相机：结束时停掉作用域
function cameraOf(page: Page) {
  const scope = effectScope();
  const camera = scope.run(() => page.map.useCamera());
  onTestFinished(() => scope.stop());
  if (!camera) {
    throw new Error('没有订阅到相机');
  }
  return camera;
}

// 读 MapLibre 画布上一个点的颜色（CSS 像素，设备像素比为 1）
function pixel({ x, y }: ScreenPoint): [number, number, number] {
  const canvas = document.querySelector<HTMLCanvasElement>('.maplibregl-canvas');
  const gl = canvas?.getContext('webgl2');
  if (!canvas || !gl) {
    throw new Error('没有 MapLibre 的画布');
  }
  const data = new Uint8Array(4);
  gl.readPixels(Math.round(x), canvas.height - Math.round(y) - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
}

// 某个通道明显压过另外两个
const dominant = (color: readonly number[], channel: 0 | 1 | 2) =>
  color.every((value, index) => index === channel || (color[channel] ?? 0) > value * 2) && (color[channel] ?? 0) > 60;

// 漫游的屋子（3C.3）：room 是 20 × 20 米、4 米高的一间，地板在 [120.66, 31.31] 地下 10 米；glTF 是文本的，
// 导航网格只读 b3dm，测试里把它的缓冲解出来拼成 GLB 再包成 b3dm
const ROOM_FLOOR = -10;
const ROOM_URL = `${FIXTURES}/room/tileset.json`;

interface TextGltf {
  readonly buffers: readonly { readonly uri: string }[];
}

// GLB 的块按 4 字节对齐
const pad = (length: number) => Math.ceil(length / 4) * 4;

function glbOf(gltf: TextGltf): ArrayBuffer {
  const [buffer] = gltf.buffers;
  if (!buffer) {
    throw new Error('屋子的 glTF 没有缓冲');
  }
  const bin = Uint8Array.from(atob(buffer.uri.slice(buffer.uri.indexOf(',') + 1)), char => char.charCodeAt(0));
  const json = new TextEncoder().encode(JSON.stringify({ ...gltf, buffers: [{ byteLength: bin.length }] }));
  const jsonChunk = new Uint8Array(pad(json.length)).fill(0x20);
  jsonChunk.set(json);
  const binChunk = new Uint8Array(pad(bin.length));
  binChunk.set(bin);
  const out = new ArrayBuffer(12 + 8 + jsonChunk.length + 8 + binChunk.length);
  const view = new DataView(out);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.byteLength, true);
  view.setUint32(12, jsonChunk.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out).set(jsonChunk, 20);
  view.setUint32(20 + jsonChunk.length, binChunk.length, true);
  view.setUint32(24 + jsonChunk.length, 0x004e4942, true);
  new Uint8Array(out).set(binChunk, 28 + jsonChunk.length);
  return out;
}

// GLB 包成 b3dm：28 字节的头、只有 BATCH_LENGTH 的特征表（按 8 字节对齐）
function b3dmOf(glb: ArrayBuffer): ArrayBuffer {
  const text = JSON.stringify({ BATCH_LENGTH: 0 });
  const feature = new TextEncoder().encode(text.padEnd(Math.ceil(text.length / 8) * 8, ' '));
  const out = new ArrayBuffer(28 + feature.length + glb.byteLength);
  const view = new DataView(out);
  new Uint8Array(out).set(new TextEncoder().encode('b3dm'), 0);
  view.setUint32(4, 1, true);
  view.setUint32(8, out.byteLength, true);
  view.setUint32(12, feature.length, true);
  new Uint8Array(out).set(feature, 28);
  new Uint8Array(out).set(new Uint8Array(glb), 28 + feature.length);
  return out;
}

const fetchJson = async (url: string): Promise<unknown> => (await fetch(url)).json();

// 屋子的导航网格：拥有者在页面里也是这样建的（主线程下载、Worker 里建）
async function roomNavigation(): Promise<Navigation> {
  const signal = new AbortController().signal;
  const prepared = await prepareTileset(ROOM_URL, fetchJson, signal);
  const gltf = (await fetchJson(`${FIXTURES}/room/room.gltf`)) as TextGltf;
  return buildNavigation(prepared, { signal, download: async () => b3dmOf(glbOf(gltf)) });
}

// 地下的屋子：会话有地下空间，漫游时抬高
function roomContent(roam?: RouteRoam | WalkRoam): SceneContent {
  const tilesets = [layer('room', ROOM_URL, { lighting: 'headlight' })];
  const underground = { tilesetId: 'room', surfaceOpacity: 0.25 };
  return roam ? { tilesets, underground, roam } : { tilesets, underground };
}

// 等 count 帧
const frames = (count: number) =>
  new Promise<void>(resolve => {
    let left = count;
    const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

// 两次相机差不多：漫游结束飞回以后
const sameCamera = (a: CameraState, b: CameraState) =>
  Math.abs(a.center[0] - b.center[0]) < 1e-4 &&
  Math.abs(a.center[1] - b.center[1]) < 1e-4 &&
  Math.abs(a.zoom - b.zoom) < 0.05 &&
  Math.abs(a.pitch - b.pitch) < 0.5;

// 漫游的进度和人的位置
const routeDistance = (page: Page) =>
  page.map.roamStatus.value?.kind === 'route' ? page.map.roamStatus.value.distance : Number.NaN;
const walkPlayer = (page: Page) =>
  page.map.roamStatus.value?.kind === 'walk' ? page.map.roamStatus.value.player : null;
const walkPhase = (page: Page) => (page.map.roamStatus.value?.kind === 'walk' ? page.map.roamStatus.value.phase : null);
// 真实的视点高度在地板上方一个眼高：抬高着，对外减掉抬高量
const eyeOnFloor = (page: Page, floor: number) =>
  Math.abs((page.map.view.value?.eyeHeight() ?? Number.NaN) - (floor + 1.6)) < 0.05;

const pressKey = (type: 'keydown' | 'keyup', code: string) => window.dispatchEvent(new KeyboardEvent(type, { code }));

describe('三维内容的契约', { timeout: TEST_TIMEOUT }, () => {
  it('加上瓦片集：先加载中，就绪时带建议的相机；按它定位后画布中心拾取到模型', async () => {
    const page = await mountPage();

    page.content.value = { tilesets: [layer('box', `${FIXTURES}/box/tileset.json`)], underground: null };
    await until(() => page.stateOf('box') === 'ready', '瓦片集就绪');
    expect(page.history.findIndex(entry => entry === 'box:loading')).toBeGreaterThanOrEqual(0);
    expect(page.history.at(-1)).toBe('box:ready');
    const ready = page.map.sceneStatus.value.get('box');
    if (ready?.state !== 'ready') {
      throw new Error('瓦片集没有就绪');
    }
    page.map.runCameraOperation(camera => camera.flyTo(ready.camera, { duration: 0, padding: 0 }));
    await until(() => {
      const hit = page.map.view.value?.pick({ x: WIDTH / 2, y: HEIGHT / 2 });
      return hit?.kind === 'hit' && hit.surface === 'model';
    }, '画布中心拾取到模型');

    expect(ready.camera.center[0]).toBeCloseTo(MODEL_AT[0], 3);
    // 夹具的球心离地 40 米：视线穿过球心，地面上的落点在球心以北 40·tan(俯角) 米
    const north = (ready.camera.center[1] - MODEL_AT[1]) * 111320;
    expect(Math.abs(north - 40 * Math.tan((ready.camera.pitch * Math.PI) / 180))).toBeLessThan(1);
    expect(page.errors).toStrictEqual([]);
  });

  it('只改显示和光照时不重新加载；删掉以后状态里不再有它', async () => {
    const page = await mountPage();
    page.content.value = { tilesets: [layer('box', `${FIXTURES}/box/tileset.json`)], underground: null };
    await until(() => page.stateOf('box') === 'ready', '瓦片集就绪');
    const loaded = page.history.length;

    page.content.value = {
      tilesets: [layer('box', `${FIXTURES}/box/tileset.json`, { lighting: 'headlight', show: false })],
      underground: null
    };
    await nextFrame();
    await nextFrame();
    expect(page.history.slice(loaded)).toStrictEqual([]);
    page.content.value = EMPTY_SCENE_CONTENT;
    await until(() => page.map.sceneStatus.value.size === 0, '状态里去掉瓦片集');

    expect(page.errors).toStrictEqual([]);
  });

  it('索引下载失败、瓦片下载失败都进入 failed；换重试次数后重新加载', async () => {
    const page = await mountPage();

    page.content.value = {
      tilesets: [layer('missing', `${FIXTURES}/missing/tileset.json`), layer('broken', `${FIXTURES}/broken/tileset.json`)],
      underground: null
    };
    page.map.runCameraOperation(camera =>
      camera.flyTo({ center: MODEL_AT, zoom: 17, bearing: 0, pitch: 45 }, { duration: 0, padding: 0 })
    );
    await until(() => page.stateOf('missing') === 'failed', '索引下载失败');
    await until(() => page.stateOf('broken') === 'failed', '瓦片下载失败');
    const failed = page.history.length;
    page.content.value = {
      tilesets: [
        layer('missing', `${FIXTURES}/missing/tileset.json`, { attempt: 1 }),
        layer('broken', `${FIXTURES}/broken/tileset.json`, { attempt: 1 })
      ],
      underground: null
    };
    await until(() => page.history.slice(failed).some(entry => entry.includes('missing:loading')), '重试时重新加载');
    await until(() => page.stateOf('missing') === 'failed' && page.stateOf('broken') === 'failed', '重试后仍然失败');

    expect(page.history.slice(failed).filter(entry => entry.includes('broken:loading')).length).toBeGreaterThan(0);
  });

  it('相机：相机操作的定位写回会话，投影和读数跟着变', async () => {
    const page = await mountPage();
    const camera = cameraOf(page);
    const target: CameraState = { center: MODEL_AT, zoom: 15, bearing: 30, pitch: 40 };

    page.map.runCameraOperation(control => control.flyTo(target, { duration: 0, padding: 0 }));
    await until(() => Math.abs(camera.value.zoom - target.zoom) < 0.05, '相机到位');
    const view = readyView(page);
    const center = view.project(target.center);

    expect(camera.value.center[0]).toBeCloseTo(target.center[0], 4);
    expect(camera.value.center[1]).toBeCloseTo(target.center[1], 4);
    expect(camera.value.bearing).toBeCloseTo(target.bearing, 0);
    expect(camera.value.pitch).toBeCloseTo(target.pitch, 0);
    expect(center?.x).toBeCloseTo(WIDTH / 2, 0);
    expect(center?.y).toBeCloseTo(HEIGHT / 2, 0);
    expect(view.heading()).toBeCloseTo(target.bearing, 0);
    // 15 级、俯仰 40 的视点约 1.1 千米高：视点高度来自 MapLibre 相机的 getCameraAltitude
    expect(view.eyeHeight()).toBeGreaterThan(900);
    expect(view.eyeHeight()).toBeLessThan(1400);
    expect(page.errors).toStrictEqual([]);
  });

  it('拾取—投影往返：打到模型表面的点带高度投影回画布，误差小于 1 像素', async () => {
    const page = await mountPage();
    await locateBox(page);
    const view = readyView(page);

    const errors = [-30, 0, 30].flatMap(dx =>
      [-30, 0, 30].flatMap(dy => {
        const point = { x: WIDTH / 2 + dx, y: HEIGHT / 2 + dy };
        const hit = view.pick(point);
        if (hit.kind !== 'hit' || hit.surface !== 'model') {
          return [];
        }
        const back = view.project(hit.lngLat, hit.height ?? 0);
        return back ? [Math.hypot(back.x - point.x, back.y - point.y)] : [Number.POSITIVE_INFINITY];
      })
    );

    expect(errors.length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...errors)).toBeLessThan(1);
  });

  it('维度切换：二维、三维都就绪，种类跟着变，相机不变', async () => {
    const page = await mountPage();
    const camera = cameraOf(page);
    page.map.runCameraOperation(control =>
      control.flyTo({ center: MODEL_AT, zoom: 16, bearing: 20, pitch: 45 }, { duration: 0, padding: 0 })
    );
    await until(() => Math.abs(camera.value.zoom - 16) < 0.05, '相机到位');
    const flatCanvas = document.querySelector('.maplibregl-canvas');

    page.map.setDimension('2d');
    await until(() => page.map.view.value?.kind === '2d', '二维就绪');
    expect(page.map.sceneStatus.value.size).toBe(0);
    page.map.setDimension('3d');
    await until(() => page.map.view.value?.kind === '3d', '三维就绪');

    expect(camera.value.center[0]).toBeCloseTo(MODEL_AT[0], 4);
    expect(camera.value.center[1]).toBeCloseTo(MODEL_AT[1], 4);
    expect(camera.value.zoom).toBeCloseTo(16, 1);
    expect(camera.value.pitch).toBeCloseTo(45, 0);
    // 二三维是同一块画布（ADR 0147 第 2 节）
    expect(document.querySelector('.maplibregl-canvas')).toBe(flatCanvas);
    expect(page.errors).toStrictEqual([]);
  });

  it('能力声明和三维里的渲染要素一致：能识别时在三维里查得到二维样式的图层', async () => {
    const page = await mountPage({ resources: square('parcel', 0.01, '#3050d0') });
    page.map.runCameraOperation(control =>
      control.flyTo({ center: MODEL_AT, zoom: 15, bearing: 0, pitch: 30 }, { duration: 0, padding: 0 })
    );
    const query = () =>
      page.map.view.value?.queryRendered({ x: WIDTH / 2, y: HEIGHT / 2 }, { sources: ['parcel'] }) ?? [];

    await until(() => query().length > 0, '三维里查到资源图层');

    expect(page.map.sceneCapabilities).toBe(MAPLIBRE_ENGINE.capabilities);
    expect(page.map.sceneCapabilities.identify).toBe(true);
  });

  it('路线漫游：放到起点，视点在地板上方 1.6 米；播放时前进、暂停时停住；结束后回到开始前的相机', async () => {
    const page = await mountPage();
    const navigation = await roomNavigation();
    page.content.value = roomContent();
    await until(() => page.stateOf('room') === 'ready', '屋子就绪');
    const camera = cameraOf(page);
    await frames(2);
    const before = camera.value;
    const real = (x: number, y: number) => navigation.frame.toLngLat([x, y, 0]);
    const route: RouteRoam = {
      kind: 'route',
      id: 'route-1',
      path: [real(-8, -6), real(-8, 6)],
      playing: false,
      speed: 2,
      run: 0
    };

    page.content.value = roomContent(route);
    await until(() => page.map.roamStatus.value?.kind === 'route', '开始路线');
    expect(page.map.roamStatus.value).toMatchObject({ id: 'route-1', distance: 0, finished: false });
    await until(() => eyeOnFloor(page, ROOM_FLOOR), '放到起点');
    page.content.value = roomContent({ ...route, playing: true });
    await until(() => routeDistance(page) > 1, '沿路线往前走');
    page.content.value = roomContent({ ...route, playing: false });
    await frames(3);
    const paused = routeDistance(page);
    await frames(15);
    expect(routeDistance(page)).toBe(paused);

    page.content.value = roomContent();
    await until(() => page.map.roamStatus.value === null, '漫游结束');
    await until(() => sameCamera(camera.value, before), '飞回开始前的相机');
    expect(page.errors).toStrictEqual([]);
  });

  it('步行：落到出生点、按 W 往前走，暂停时不走，瞬移到指定位置；结束后回到开始前的相机', async () => {
    const page = await mountPage();
    const navigation = await roomNavigation();
    page.content.value = roomContent();
    await until(() => page.stateOf('room') === 'ready', '屋子就绪');
    const camera = cameraOf(page);
    await frames(2);
    const before = camera.value;
    const [lng, lat, height] = navigation.frame.toLngLat([0, -6, 0]);
    const walk: WalkRoam = {
      kind: 'walk',
      id: 'walk-1',
      navigation,
      spawn: { lng, lat, height, heading: 0 },
      speed: 2,
      respawn: 0,
      unstuck: 0,
      paused: false,
      teleport: null,
      view: 'first',
      avatar: `${window.location.origin}/avatar.glb`
    };

    page.content.value = roomContent(walk);
    await until(() => walkPhase(page) !== null, '开始步行');
    expect(walkPhase(page)).toBe('entering');
    await until(() => walkPhase(page) === 'walking' && walkPlayer(page) !== null, '落到出生点');
    const spawn = walkPlayer(page);
    expect(Math.hypot((spawn?.x ?? Number.NaN) - 0, (spawn?.y ?? Number.NaN) + 6)).toBeLessThan(0.5);
    await until(() => eyeOnFloor(page, ROOM_FLOOR), '视点在出生点上方');

    pressKey('keydown', 'KeyW');
    await until(() => (walkPlayer(page)?.y ?? Number.NaN) > (spawn?.y ?? 0) + 0.5, '往北走');
    pressKey('keyup', 'KeyW');

    page.content.value = roomContent({ ...walk, paused: true });
    await frames(3);
    const stopped = walkPlayer(page)?.y;
    pressKey('keydown', 'KeyW');
    await frames(15);
    pressKey('keyup', 'KeyW');
    expect(walkPlayer(page)?.y).toBe(stopped);

    // 完整地图打开（暂停）时双击瞬移
    page.content.value = roomContent({ ...walk, paused: true, teleport: { count: 1, spot: { x: 5, y: 5, floor: 0 } } });
    await until(() => Math.hypot((walkPlayer(page)?.x ?? 0) - 5, (walkPlayer(page)?.y ?? 0) - 5) < 0.01, '瞬移');

    page.content.value = roomContent();
    await until(() => page.map.roamStatus.value === null, '漫游结束');
    await until(() => sameCamera(camera.value, before), '飞回开始前的相机');
    expect(page.errors).toStrictEqual([]);
  });

  it('叠放：sceneBelow 以下的分组被模型挡住，以上的画在模型上面', async () => {
    // 资源是一大块蓝色，注记是模型正下方的一小块绿色
    const page = await mountPage({
      resources: square('parcel', 0.01, '#3050d0'),
      labels: square('label', 0.00005, '#20c040')
    });
    await locateBox(page);
    const view = readyView(page);
    const under = view.project(MODEL_AT);
    if (!under) {
      throw new Error('模型正下方不在画布上');
    }
    // 模型上离注记远一些的点
    const onModel = [-60, 60]
      .map(dx => ({ x: WIDTH / 2 + dx, y: HEIGHT / 2 }))
      .find(point => {
        const hit = view.pick(point);
        return hit.kind === 'hit' && hit.surface === 'model' && Math.hypot(point.x - under.x, point.y - under.y) > 20;
      });
    if (!onModel) {
      throw new Error('没有找到模型上的点');
    }

    await until(() => dominant(pixel(under), 1), '注记画在模型上面');
    expect(dominant(pixel(onModel), 0)).toBe(true);
  });

  it('三维模块加载失败只让三维失败：二维照常可用，重试只重新加载模块', async () => {
    let fail = true;
    let loads = 0;
    const flaky: SceneEngine = {
      ...MAPLIBRE_ENGINE,
      loadRenderer: () => {
        loads++;
        return fail ? Promise.reject(new Error('三维模块下载失败')) : MAPLIBRE_ENGINE.loadRenderer();
      }
    };
    const page = await mountPage({ engine: flaky, waitReady: false });
    await until(() => page.map.viewState.value === 'failed', '三维失败');
    expect(page.map.failure.value?.kind).toBe('module');
    const canvas = document.querySelector('.maplibregl-canvas');

    page.map.setDimension('2d');
    await until(() => page.map.viewState.value === 'ready', '二维就绪');
    page.map.setDimension('3d');
    expect(page.map.viewState.value).toBe('failed');
    fail = false;
    page.map.retry();
    await until(() => page.map.viewState.value === 'ready', '重试后三维就绪');
    await locateBox(page);

    expect(loads).toBe(2);
    expect(document.querySelector('.maplibregl-canvas')).toBe(canvas);
  });

  it(
    '高斯泼溅：先加载中，就绪时带建议的相机，按它定位后拾取到泼溅；GL 上下文丢失后恢复还在；删掉以后状态里不再有它',
    async () => {
      const page = await mountPage();
      const url = await writtenSplat();

      page.content.value = { tilesets: [], splats: [splatLayer(url)], underground: null };
      await until(() => page.stateOf('square') === 'ready', '泼溅就绪');
      expect(page.history).toContain('square:loading');
      const ready = page.map.sceneStatus.value.get('square');
      if (ready?.state !== 'ready') {
        throw new Error('泼溅没有就绪');
      }
      expect(ready.camera.center[0]).toBeCloseTo(MODEL_AT[0], 4);
      expect(ready.camera.center[1]).toBeCloseTo(MODEL_AT[1], 4);
      page.map.runCameraOperation(camera => camera.flyTo(ready.camera, { duration: 0, padding: 0 }));
      const pickedHeight = () => {
        const hit = page.map.view.value?.pick({ x: WIDTH / 2, y: HEIGHT / 2 });
        return hit?.kind === 'hit' && hit.surface === 'model' ? (hit.height ?? null) : null;
      };
      await until(() => pickedHeight() !== null, '画布中心拾取到泼溅');
      expect(pickedHeight()).toBeCloseTo(0, 0);
      await until(() => dominant(pixel({ x: WIDTH / 2, y: HEIGHT / 2 }), 1), '画出绿色的泼溅');

      const canvas = document.querySelector<HTMLCanvasElement>('.maplibregl-canvas');
      const gl = canvas?.getContext('webgl2');
      const lose = gl?.getExtension('WEBGL_lose_context');
      if (!canvas || !gl || !lose) {
        throw new Error('没有 MapLibre 的画布或 WEBGL_lose_context');
      }
      const lost = new Promise<void>(resolve => canvas.addEventListener('webglcontextlost', () => resolve(), { once: true }));
      lose.loseContext();
      await within(lost, 'GL 上下文丢失');
      await new Promise(resolve => setTimeout(resolve, 0));
      lose.restoreContext();
      await until(() => !gl.isContextLost() && pickedHeight() !== null, '恢复后再次拾取到泼溅');
      await until(() => dominant(pixel({ x: WIDTH / 2, y: HEIGHT / 2 }), 1), '恢复后再次画出泼溅');
      expect(page.stateOf('square')).toBe('ready');

      page.content.value = { tilesets: [], underground: null };
      await until(() => page.stateOf('square') === undefined, '删掉泼溅');
      expect(pickedHeight()).toBeNull();
      expect(page.errors).toStrictEqual([]);
    }
  );

  it('离地的泼溅：按建议的相机定位后，画布中心是模型，不是它脚下的地面', async () => {
    const page = await mountPage();
    const url = await writtenSplat();
    const height = 150;
    const placement = { lng: MODEL_AT[0], lat: MODEL_AT[1], height, heading: 0 };

    page.content.value = { tilesets: [], splats: [splatLayer(url, { placement })], underground: null };
    await until(() => page.stateOf('square') === 'ready', '泼溅就绪');
    const ready = page.map.sceneStatus.value.get('square');
    if (ready?.state !== 'ready') {
      throw new Error('泼溅没有就绪');
    }
    // 相机朝北：视线要穿过 height 高处的球心，地面上的落点在球心以北 height·tan(俯角)
    const north = (ready.camera.center[1] - MODEL_AT[1]) * 111320;
    expect(Math.abs(north - height * Math.tan((ready.camera.pitch * Math.PI) / 180))).toBeLessThan(2);
    page.map.runCameraOperation(camera => camera.flyTo(ready.camera, { duration: 0, padding: 0 }));
    const pickedHeight = () => {
      const hit = page.map.view.value?.pick({ x: WIDTH / 2, y: HEIGHT / 2 });
      return hit?.kind === 'hit' && hit.surface === 'model' ? (hit.height ?? null) : null;
    };
    await until(() => pickedHeight() !== null, '画布中心拾取到离地的泼溅');

    expect(pickedHeight()).toBeCloseTo(height, 0);
    expect(page.errors).toStrictEqual([]);
  });

  it('GL 上下文丢失后恢复：瓦片集仍是就绪，照样拾取到模型', async () => {
    const page = await mountPage();
    page.content.value = { tilesets: [layer('box', `${FIXTURES}/box/tileset.json`)], underground: null };
    await until(() => page.stateOf('box') === 'ready', '瓦片集就绪');
    page.map.runCameraOperation(camera =>
      camera.flyTo({ center: MODEL_AT, zoom: 17, bearing: 0, pitch: 45 }, { duration: 0, padding: 0 })
    );
    const pickedModel = () => {
      const hit = page.map.view.value?.pick({ x: WIDTH / 2, y: HEIGHT / 2 });
      return hit?.kind === 'hit' && hit.surface === 'model';
    };
    await until(pickedModel, '拾取到模型');
    const canvas = document.querySelector<HTMLCanvasElement>('.maplibregl-canvas');
    const gl = canvas?.getContext('webgl2');
    const lose = gl?.getExtension('WEBGL_lose_context');
    if (!canvas || !gl || !lose) {
      throw new Error('没有 MapLibre 的画布或 WEBGL_lose_context');
    }

    const lost = new Promise<void>(resolve => canvas.addEventListener('webglcontextlost', () => resolve(), { once: true }));
    lose.loseContext();
    await within(lost, 'GL 上下文丢失');
    // 在派发丢失事件的同一个任务里调用 restoreContext，Chromium 不恢复（2026-11-06 实测）
    await new Promise(resolve => setTimeout(resolve, 0));
    lose.restoreContext();
    await until(() => !gl.isContextLost() && pickedModel(), '恢复后再次拾取到模型');

    expect(page.stateOf('box')).toBe('ready');
  });
});
