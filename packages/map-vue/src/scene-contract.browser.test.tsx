import {
  type CameraState,
  EMPTY_SCENE_CONTENT,
  type SceneContent,
  type StyleGroup,
  type TilesetLayer,
  type TilesetStatus
} from '@mx/map-core';
import { mount } from '@vue/test-utils';
import { describe, expect, it, onTestFinished } from 'vitest';
import { defineComponent, provide, shallowRef, watch } from 'vue';
import { CesiumCanvas } from './CesiumCanvas';
import { MapCanvas } from './MapCanvas';
import { type MapHandle, provideMap } from './provide-map';
import { CESIUM_ENGINE, MAP_RUNTIME, MAP_SCENE_ENGINE, MAPLIBRE_ENGINE, type SceneEngine } from './runtime';

// 两种三维引擎的契约测试（ADR 0147 第 3 节）：同一组用例分别跑真实的 Cesium 和 MapLibre + Three，
// 和页面一样只通过 provideMap、bindScene、setDimension、相机操作和上下文的状态使用地图。
// 3C.1 覆盖三维内容的增删、状态、失败和重试，以及 GL 上下文的丢失和恢复（只有 maplibre）

// 夹具是提交在 src/testing/scene-fixtures 的文本文件，由测试的开发服务器提供：box 是边长 80 米的红色立方体（glTF，缓冲内嵌），
// 放在 [120.66, 31.31] 的地面上；broken 是同一个瓦片集，但瓦片的地址不存在
const MODEL_AT = [120.66, 31.31] as const;
const FIXTURES = `${window.location.origin}/src/testing/scene-fixtures`;
const CAMERA: CameraState = { center: [120.6, 31.3], zoom: 12, bearing: 0, pitch: 0 };
const BACKGROUND: StyleGroup = {
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#202020' } }]
};
// 软件渲染下 Cesium 的启动、瓦片的加载都慢：用例的时限放宽到 60 秒；可能一直等不到的条件和它赛跑
const TEST_TIMEOUT = 60000;
const WAIT_TIMEOUT = 45000;
const WIDTH = 640;
const HEIGHT = 480;

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

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

// Cesium 的运行时（ADR 0079 第 2 节）：应用里由 app 注入，这里只设置基础地址；map-vue 只能动态导入 map-cesium。
// 应用的运行时还引入 CesiumWidget.css，包里不能导入 cesium 的文件，只补上让画布铺满容器的两条
async function loadRuntime(): Promise<void> {
  const { setCesiumBaseUrl } = await import('@mx/map-cesium');
  setCesiumBaseUrl('/cesium/');
  if (!document.querySelector('style[data-cesium-widget]')) {
    const style = document.head.appendChild(document.createElement('style'));
    style.dataset.cesiumWidget = '';
    style.textContent = '.cesium-widget, .cesium-widget canvas { width: 100%; height: 100%; }';
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

// 页面：两块画布、底图、三维内容的推导函数；切到三维、等视图就绪
async function mountPage(engine: SceneEngine) {
  const content = shallowRef<SceneContent>(EMPTY_SCENE_CONTENT);
  const errors: unknown[] = [];
  let handle: MapHandle<'basemap'> | undefined;
  const Page = defineComponent(() => {
    provide(MAP_SCENE_ENGINE, engine);
    provide(MAP_RUNTIME, loadRuntime);
    handle = provideMap({ groups: ['basemap'], camera: CAMERA, onError: error => errors.push(error) });
    handle.bindStyle({ basemap: () => BACKGROUND });
    handle.bindScene(() => content.value);
    return () => (
      <div style={{ position: 'relative', width: `${WIDTH}px`, height: `${HEIGHT}px` }}>
        <MapCanvas mapOptions={{ maxZoom: 24, centerClampedToGround: false }} />
        <CesiumCanvas />
      </div>
    );
  });
  const wrapper = mount(Page, { attachTo: document.body });
  onTestFinished(() => wrapper.unmount());
  const map = handle;
  if (!map) {
    throw new Error('没有创建地图句柄');
  }
  map.setDimension('3d');
  await until(() => map.viewState.value === 'ready', '三维视图就绪');
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

describe('三维内容的契约', { timeout: TEST_TIMEOUT }, () => {
describe.each([
  ['cesium', CESIUM_ENGINE],
  ['maplibre', MAPLIBRE_ENGINE]
] as const)('%s', (name, engine) => {
  it('加上瓦片集：先加载中，就绪时带建议的相机；按它定位后画布中心拾取到模型', async () => {
    const page = await mountPage(engine);

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
    expect(ready.camera.center[1]).toBeCloseTo(MODEL_AT[1], 3);
    expect(page.errors).toStrictEqual([]);
  });

  it('只改显示和光照时不重新加载；删掉以后状态里不再有它', async () => {
    const page = await mountPage(engine);
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
    const page = await mountPage(engine);

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

  it.runIf(name === 'maplibre')('GL 上下文丢失后恢复：瓦片集仍是就绪，照样拾取到模型（只有 maplibre）', async () => {
    const page = await mountPage(engine);
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
    await lost;
    // 在派发丢失事件的同一个任务里调用 restoreContext，Chromium 不恢复（2026-11-06 实测）
    await new Promise(resolve => setTimeout(resolve, 0));
    lose.restoreContext();
    await until(() => !gl.isContextLost() && pickedModel(), '恢复后再次拾取到模型');

    expect(page.stateOf('box')).toBe('ready');
  });
});
});
