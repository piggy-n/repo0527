import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import type { CameraChange, CameraState } from '../camera/camera-model';
import { MapSession } from '../session/map-session';
import type { StyleImage } from '../style/style-image';
import type { StyleGroup } from '../style/style-model';
import { BROWSE_TOOL } from '../tool/tool-model';
import type { SourceErrors, ViewState } from '../view/map-view';
import type { LngLat, PickResult } from '../view/view-input';
import { MapLibreView } from './maplibre-view';

// 真实的 MapLibre（ADR 0040）：只用内联的 GeoJSON，不请求外部服务

const CAMERA: CameraState = { center: [118.8, 32.05], zoom: 8, bearing: 0, pitch: 0 };
// 可能一直等不到的事件和它赛跑，失败落在断言上
const WAIT_TIMEOUT = 5000;

const AREA: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: '玄武' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [118.6, 31.9],
            [119, 31.9],
            [119, 32.2],
            [118.6, 32.2],
            [118.6, 31.9]
          ]
        ]
      }
    }
  ]
};

function areaGroup(paint: Record<string, unknown> = { 'fill-color': '#ff0000' }, metadata?: unknown): StyleGroup {
  return {
    sources: { area: { type: 'geojson', data: AREA } },
    layers: [
      {
        id: 'area-fill',
        type: 'fill',
        source: 'area',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint,
        ...(metadata === undefined ? {} : { metadata })
      }
    ]
  };
}

// MapLibre 把一帧里收到的手势合在一起，在动画帧里应用
const twoFrames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

// 从画布中心按下，分几步向右拖 100 像素后松开，全程按着 init 里的修饰键
async function dragRight(map: MapLibreMap, button: 0 | 2, init: MouseEventInit = {}) {
  const canvas = map.getCanvas();
  const { left, top } = canvas.getBoundingClientRect();
  const buttons = button === 0 ? 1 : 2;
  const at = (x: number) => ({ bubbles: true, button, buttons, clientX: left + x, clientY: top + 300, ...init });
  canvas.dispatchEvent(new MouseEvent('mousedown', at(400)));
  for (const x of [420, 440, 460, 480, 500]) {
    canvas.dispatchEvent(new MouseEvent('mousemove', at(x)));
  }
  await twoFrames();
  canvas.dispatchEvent(new MouseEvent('mouseup', { ...at(500), buttons: 0 }));
  await twoFrames();
}

// 每个用例自己的容器（尺寸写死）、会话和视图，结束时一起释放并移除容器：同一个文件的用例共用一个页面
function setup(camera: CameraState = CAMERA, initial?: StyleGroup) {
  const container = document.body.appendChild(document.createElement('div'));
  container.style.width = '800px';
  container.style.height = '600px';
  const session = new MapSession({ groups: ['data'], camera });
  // 创建视图之前就有的样式：地图按这份快照创建
  if (initial) {
    session.style.setGroup('data', initial);
  }
  const errors: unknown[] = [];
  let created: MapLibreMap | undefined;
  const view = new MapLibreView({
    session,
    container,
    createMap: options => (created = new MapLibreMap(options)),
    onError: error => errors.push(error)
  });
  return {
    container,
    session,
    view,
    errors,
    get map(): MapLibreMap {
      if (!created) {
        throw new Error('地图没有创建');
      }
      return created;
    },
    [Symbol.dispose]() {
      view[Symbol.dispose]();
      session[Symbol.dispose]();
      container.remove();
    }
  };
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${WAIT_TIMEOUT} ms 内没有等到${label}`)), WAIT_TIMEOUT);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 等到视图的状态满足条件；监听在触发操作之前登记，结束后取消
function waitForState(view: MapLibreView<'data'>, accept: (state: ViewState) => boolean): Promise<ViewState> {
  let unsubscribe: (() => void) | undefined;
  const reached = new Promise<ViewState>(resolve => {
    if (accept(view.state)) {
      resolve(view.state);
      return;
    }
    unsubscribe = view.on('statechange', state => {
      if (accept(state)) {
        resolve(state);
      }
    });
  });
  return withTimeout(reached, '视图的状态').finally(() => unsubscribe?.());
}

// 渲染完成：每次 idle 之后检查条件（whenReady 只表示整体加载完成，不保证增量的数据已经画出来）
function renderedUntil(map: MapLibreMap, accept: () => boolean): Promise<void> {
  let listener: (() => void) | undefined;
  const rendered = new Promise<void>(resolve => {
    listener = () => {
      if (accept()) {
        resolve();
      }
    };
    map.on('idle', listener);
    // 已经空闲时不会再有 idle：触发一次重绘
    map.triggerRepaint();
  });
  return withTimeout(rendered, '渲染出目标内容').finally(() => listener && map.off('idle', listener));
}

const renderedAreas = (map: MapLibreMap) => map.queryRenderedFeatures({ layers: ['area-fill'] }).length;

const lngLatOf = (result: PickResult): LngLat | null => (result.kind === 'hit' ? result.lngLat : null);

// 距离场图片：整块都在边缘以内，画出来就是纹理颜色；fill 换像素
function sdfImage(size = 2, fill = 255): StyleImage {
  return { width: size, height: size, data: new Uint8Array(size * size * 4).fill(fill), pixelRatio: 1, sdf: true };
}

function patternGroup(image: StyleImage = sdfImage(), layerExtra: Record<string, unknown> = {}): StyleGroup {
  const [layer] = areaGroup({ 'fill-pattern': 'data-stripe', 'fill-color': '#ff0000' }).layers;
  return {
    ...areaGroup(),
    layers: [{ ...layer, ...layerExtra }],
    images: { 'data-stripe': image }
  };
}

function square(guid: string, west: number, east: number): Feature<Polygon> {
  const [south, north] = [31.95, 32.15];
  const ring = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south]
  ];
  return { type: 'Feature', properties: { guid }, geometry: { type: 'Polygon', coordinates: [ring] } };
}

const collection = (...features: Feature<Polygon>[]): FeatureCollection<Polygon> => ({
  type: 'FeatureCollection',
  features
});

// 两块地块和压在第一块上的覆盖面；地块的数据源有填充、轮廓两个图层
function parcelsGroup(): StyleGroup {
  return {
    sources: {
      parcels: { type: 'geojson', data: collection(square('a', 118.6, 118.75), square('b', 118.85, 119)) },
      cover: { type: 'geojson', data: collection(square('c', 118.65, 118.7)) }
    },
    layers: [
      { id: 'parcels-fill', type: 'fill', source: 'parcels', paint: { 'fill-color': '#ff0000' } },
      { id: 'parcels-outline', type: 'line', source: 'parcels', paint: { 'line-color': '#000000', 'line-width': 2 } },
      { id: 'cover-fill', type: 'fill', source: 'cover', paint: { 'fill-color': '#0000ff' } }
    ]
  };
}

// 记下 MapLibre 报告缺少的图片：图层要用时图片还没加上
function missingImages(map: MapLibreMap): string[] {
  const missing: string[] = [];
  map.on('styleimagemissing', ({ id }) => missing.push(id));
  return missing;
}

describe('MapLibreView（真实的 MapLibre）', () => {
  it('首次加载：style.load 后进入 ready；俯角按 MapLibre 的上限收敛，按 sync 写回会话', async () => {
    using ctx = setup({ ...CAMERA, pitch: 75 });
    const changes: CameraChange[] = [];
    ctx.session.camera.on('change', change => changes.push(change));

    await withTimeout(ctx.view.whenReady(), '首次加载完成');

    expect(ctx.view.state).toBe('ready');
    expect(ctx.map.getMaxPitch()).toBe(60);
    expect(ctx.session.camera.current.pitch).toBe(60);
    expect(changes.map(({ view, cause }) => [view, cause])).toStrictEqual([['2d', 'sync']]);
  });

  it('画面稳定：首次加载时 settle 在进入 ready 之后发出，那时初始样式的数据已经画出', async () => {
    using ctx = setup(CAMERA, areaGroup());
    let drawn: { state: ViewState; areas: number } | undefined;
    let unsubscribe: (() => void) | undefined;
    const settled = new Promise<void>(resolve => {
      unsubscribe = ctx.view.on('settle', () => {
        drawn ??= { state: ctx.view.state, areas: renderedAreas(ctx.map) };
        resolve();
      });
    });

    await withTimeout(settled, '画面稳定').finally(() => unsubscribe?.());

    expect(drawn?.state).toBe('ready');
    expect(drawn?.areas).toBeGreaterThan(0);
  });

  it('增量提交：只用增量命令，不整体重建，渲染完成后能查到画出的要素', async () => {
    using ctx = setup();
    await withTimeout(ctx.view.whenReady(), '首次加载完成');
    const setStyle = vi.spyOn(ctx.map, 'setStyle');

    ctx.session.style.setGroup('data', areaGroup());
    await renderedUntil(ctx.map, () => renderedAreas(ctx.map) > 0);

    expect(setStyle).not.toHaveBeenCalled();
    expect(ctx.view.state).toBe('ready');
    expect(ctx.errors).toStrictEqual([]);
  });

  it('样式规范以外的图层属性：diff 产生不支持的 setLayerProperty，整体重建并加载成功（MapLibre 不校验未知属性）；metadata 的变化 diff 直接跳过', async () => {
    using ctx = setup();
    await withTimeout(ctx.view.whenReady(), '首次加载完成');
    ctx.session.style.setGroup('data', areaGroup());
    await renderedUntil(ctx.map, () => renderedAreas(ctx.map) > 0);
    const setStyle = vi.spyOn(ctx.map, 'setStyle');

    ctx.session.style.setGroup('data', areaGroup(undefined, { owner: 'test' }));
    await Promise.resolve();
    expect(setStyle).not.toHaveBeenCalled();

    const [layer] = areaGroup().layers;
    const flagged = { ...layer, 'custom-flag': true } as unknown as StyleGroup['layers'][number];
    ctx.session.style.setGroup('data', { ...areaGroup(), layers: [flagged] });
    await Promise.resolve();
    // 就绪时的整体重建不改变状态，whenReady 换成新一轮：等这一轮的结果
    const round = await withTimeout(
      ctx.view.whenReady().then(
        () => 'loaded',
        () => 'failed'
      ),
      '整体重建的结果'
    );

    expect(setStyle).toHaveBeenCalledOnce();
    expect(setStyle.mock.calls[0]?.[1]).toStrictEqual({ diff: false });
    expect(round).toBe('loaded');
    expect(ctx.view.state).toBe('ready');
    expect(ctx.errors).toStrictEqual([]);
    await renderedUntil(ctx.map, () => renderedAreas(ctx.map) > 0);
  });

  it('不合法的图层：增量添加只发 error 不抛错，整体重建时整份样式校验失败，进入 failed(style)；去掉后自动恢复', async () => {
    using ctx = setup();
    await withTimeout(ctx.view.whenReady(), '首次加载完成');
    const setStyle = vi.spyOn(ctx.map, 'setStyle');

    ctx.session.style.setGroup('data', areaGroup({ 'fill-color': 'not-a-color' }));
    await waitForState(ctx.view, state => state === 'failed');

    expect(setStyle).toHaveBeenCalledOnce();
    expect(ctx.view.failure?.kind).toBe('style');
    expect(ctx.errors.length).toBeGreaterThan(0);
    expect(String(ctx.errors[0])).toContain('fill-color');
    await expect(ctx.view.whenReady()).rejects.toBeDefined();

    ctx.session.style.setGroup('data', areaGroup());
    await waitForState(ctx.view, state => state === 'ready');
    await renderedUntil(ctx.map, () => renderedAreas(ctx.map) > 0);

    expect(ctx.view.failure).toBeNull();
  });

  it('数据源加载失败：error 事件带 sourceId，只记进数据源错误，视图保持 ready、不整体重建；移除数据源后清掉', async () => {
    using ctx = setup();
    await withTimeout(ctx.view.whenReady(), '首次加载完成');
    const setStyle = vi.spyOn(ctx.map, 'setStyle');
    let unsubscribe: (() => void) | undefined;
    const recorded = new Promise<SourceErrors>(resolve => (unsubscribe = ctx.view.on('sourceerrorchange', resolve)));

    // data: 地址不发网络请求，内容不是 JSON，MapLibre 解析失败
    ctx.session.style.setGroup('data', {
      sources: { broken: { type: 'geojson', data: 'data:application/json,not-json' } },
      layers: [{ id: 'broken-fill', type: 'fill', source: 'broken' }]
    });
    const errors = await withTimeout(recorded, '数据源错误').finally(() => unsubscribe?.());

    expect([...errors.keys()]).toStrictEqual(['broken']);
    expect(ctx.errors).toContain(errors.get('broken'));
    expect(ctx.view.state).toBe('ready');
    expect(setStyle).not.toHaveBeenCalled();

    ctx.session.style.setGroup('data', areaGroup());
    await renderedUntil(ctx.map, () => renderedAreas(ctx.map) > 0);
    expect(ctx.view.sourceErrors.size).toBe(0);
  });

  describe('样式图片（ADR 0045）', () => {
    it('首次加载：创建时快照里的图片在图层用到之前就加上，不缺图', async () => {
      using ctx = setup(CAMERA, patternGroup());
      const missing = missingImages(ctx.map);

      await withTimeout(ctx.view.whenReady(), '首次加载完成');
      await renderedUntil(ctx.map, () => renderedAreas(ctx.map) > 0);

      expect(ctx.map.hasImage('data-stripe')).toBe(true);
      expect(missing).toStrictEqual([]);
      expect(ctx.errors).toStrictEqual([]);
    });

    it('只改图片：同样格式的只换像素、换了格式的先删除再添加，都不整体重建；去掉后删除', async () => {
      using ctx = setup();
      const missing = missingImages(ctx.map);
      await withTimeout(ctx.view.whenReady(), '首次加载完成');
      ctx.session.style.setGroup('data', patternGroup());
      await renderedUntil(ctx.map, () => renderedAreas(ctx.map) > 0);
      const setStyle = vi.spyOn(ctx.map, 'setStyle');
      const updateImage = vi.spyOn(ctx.map, 'updateImage');

      ctx.session.style.setGroup('data', patternGroup(sdfImage(2, 200)));
      await Promise.resolve();
      expect(updateImage).toHaveBeenCalledOnce();
      ctx.session.style.setGroup('data', patternGroup(sdfImage(4)));
      await Promise.resolve();
      await renderedUntil(ctx.map, () => renderedAreas(ctx.map) > 0);
      expect(setStyle).not.toHaveBeenCalled();
      expect(updateImage).toHaveBeenCalledOnce();
      expect(ctx.errors).toStrictEqual([]);

      ctx.session.style.setGroup('data', areaGroup());
      await Promise.resolve();
      expect(ctx.map.hasImage('data-stripe')).toBe(false);
      expect(missing).toStrictEqual([]);
    });

    it('整体重建：新样式里按当前快照重新加上图片，不报"已存在"、不缺图', async () => {
      using ctx = setup();
      const missing = missingImages(ctx.map);
      await withTimeout(ctx.view.whenReady(), '首次加载完成');
      ctx.session.style.setGroup('data', patternGroup());
      await renderedUntil(ctx.map, () => renderedAreas(ctx.map) > 0);
      const setStyle = vi.spyOn(ctx.map, 'setStyle');

      // 样式规范以外的图层属性让 diff 产生不支持的命令，整体重建
      ctx.session.style.setGroup('data', patternGroup(sdfImage(), { 'custom-flag': true }));
      await Promise.resolve();
      await withTimeout(ctx.view.whenReady(), '整体重建完成');
      await renderedUntil(ctx.map, () => renderedAreas(ctx.map) > 0);

      expect(setStyle).toHaveBeenCalledOnce();
      expect(ctx.map.hasImage('data-stripe')).toBe(true);
      expect(missing).toStrictEqual([]);
      expect(ctx.errors).toStrictEqual([]);
    });
  });

  it('拾取与投影：投影再拾取回到原来的经纬度，画布中心拾取到会话相机的中心', async () => {
    using ctx = setup();
    await withTimeout(ctx.view.whenReady(), '首次加载完成');

    const point = ctx.view.project([118.9, 32.1]);
    const picked = ctx.view.pick(point);
    const center = ctx.view.pick({ x: 400, y: 300 });

    expect([picked.kind, center.kind]).toStrictEqual(['hit', 'hit']);
    expect(lngLatOf(picked)?.[0]).toBeCloseTo(118.9, 6);
    expect(lngLatOf(picked)?.[1]).toBeCloseTo(32.1, 6);
    expect(lngLatOf(center)?.[0]).toBeCloseTo(ctx.session.camera.current.center[0], 6);
    expect(lngLatOf(center)?.[1]).toBeCloseTo(ctx.session.camera.current.center[1], 6);
  });

  it('渲染要素查询（ADR 0047）：点和矩形里画出的要素，只查给定数据源的图层，从上到下；几何只在要时给出', async () => {
    using ctx = setup();
    await withTimeout(ctx.view.whenReady(), '首次加载完成');
    ctx.session.style.setGroup('data', parcelsGroup());
    await renderedUntil(ctx.map, () => ctx.map.queryRenderedFeatures({ layers: ['cover-fill'] }).length > 0);

    // 第一块地块里、覆盖面下面的一点
    const point = ctx.view.project([118.68, 32.05]);
    const hits = (sources: string[]) =>
      ctx.view.queryRendered(point, { sources }).map(({ sourceId, layerId, properties }) => [sourceId, layerId, properties.guid]);
    expect(hits(['parcels', 'cover'])).toStrictEqual([
      ['cover', 'cover-fill', 'c'],
      ['parcels', 'parcels-fill', 'a']
    ]);
    expect(hits(['parcels'])).toStrictEqual([['parcels', 'parcels-fill', 'a']]);
    expect(hits(['missing'])).toStrictEqual([]);

    const [plain] = ctx.view.queryRendered(point, { sources: ['parcels'] });
    const [withGeometry] = ctx.view.queryRendered(point, { sources: ['parcels'], withGeometry: true });
    expect(plain).not.toHaveProperty('geometry');
    expect(withGeometry?.geometry?.type).toBe('Polygon');

    // 矩形盖住两块地块：填充和轮廓都画了它们，去重交给调用方
    const box = { from: ctx.view.project([118.55, 32.2]), to: ctx.view.project([119.05, 31.9]) };
    const inBox = ctx.view.queryRendered(box, { sources: ['parcels'] });
    expect(new Set(inBox.map(({ properties }) => properties.guid))).toStrictEqual(new Set(['a', 'b']));
    expect(new Set(inBox.map(({ layerId }) => layerId))).toStrictEqual(new Set(['parcels-fill', 'parcels-outline']));
  });

  describe('按住修饰键临时拖动（ADR 0056）', () => {
    it('声明了 Ctrl 的工具：按住 Ctrl 拖动是平移、不旋转，工具收不到这次按下；右键拖动照常旋转', async () => {
      using ctx = setup();
      await withTimeout(ctx.view.whenReady(), '首次加载完成');
      const inputs: string[] = [];
      ctx.session.tool.register('pick', {
        persistent: true,
        cursor: 'crosshair',
        gestures: { dragPan: false, boxZoom: false },
        panModifier: 'ctrl',
        handleInput: event => void inputs.push(event.type)
      });
      ctx.session.tool.activate('pick');
      const grabbed = lngLatOf(ctx.view.pick({ x: 400, y: 300 }));

      await dragRight(ctx.map, 0, { ctrlKey: true });

      // 按下时画布中心的地方跟着指针向右移了 100 像素
      expect(grabbed && ctx.view.project(grabbed).x).toBeCloseTo(500, 0);
      expect([ctx.map.getBearing(), ctx.map.getPitch()]).toStrictEqual([0, 0]);
      expect(ctx.session.camera.current.center).not.toStrictEqual(CAMERA.center);
      expect(new Set(inputs)).toStrictEqual(new Set(['move']));

      await dragRight(ctx.map, 2);
      expect(ctx.map.getBearing()).not.toBe(0);
    });

    it('对照：没有声明修饰键的工具（移动）按住 Ctrl 拖动，是 MapLibre 的旋转', async () => {
      using ctx = setup();
      await withTimeout(ctx.view.whenReady(), '首次加载完成');
      expect(ctx.session.tool.active).toBe(BROWSE_TOOL);

      await dragRight(ctx.map, 0, { ctrlKey: true });

      expect(ctx.map.getBearing()).not.toBe(0);
    });
  });

  it('画布尺寸变化：发出 resize，相机不变，同一个经纬度投影到新的位置', async () => {
    using ctx = setup();
    await withTimeout(ctx.view.whenReady(), '首次加载完成');
    const before = ctx.view.project([118.9, 32.1]);
    let unsubscribe: (() => void) | undefined;
    const resized = new Promise<void>(resolve => (unsubscribe = ctx.view.on('resize', resolve)));

    ctx.container.style.width = '1000px';
    await withTimeout(resized, ' resize').finally(() => unsubscribe?.());

    const after = ctx.view.project([118.9, 32.1]);
    expect(ctx.session.camera.current.center).toStrictEqual(CAMERA.center);
    expect(after.x - before.x).toBeCloseTo(100, 0);
  });
});
