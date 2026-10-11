import type { FeatureCollection, Polygon } from 'geojson';
import { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import type { CameraChange, CameraState } from '../camera/camera-model';
import { MapSession } from '../session/map-session';
import type { StyleGroup } from '../style/style-model';
import type { ViewState } from '../view/map-view';
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

// 每个用例自己的容器（尺寸写死）、会话和视图，结束时一起释放并移除容器：同一个文件的用例共用一个页面
function setup(camera: CameraState = CAMERA) {
  const container = document.body.appendChild(document.createElement('div'));
  container.style.width = '800px';
  container.style.height = '600px';
  const session = new MapSession({ groups: ['data'], camera });
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
