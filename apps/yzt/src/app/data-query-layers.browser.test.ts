import { type CameraState, MapLibreView, MapSession } from '@yzt/map-core';
import { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import type { QueryRequest, ResultFeatures } from '@/features/data-query/api';
import { featureCollection, RESULT_GROUP, resultGroup } from '@/features/data-query/result-layers';
import { QUERY_TOPICS } from '@/features/data-query/topics';
import { drawGroup, polygonOf } from '@/shared/map/draw/shape-draw';

// 数据查询的空间结果和画的范围放在真实 MapLibre 上：分组推导出来的图层能画出要素、没有报错。
// 放在 app 里：要用原生地图等渲染完成、查画出的要素，只有 app 和 MapLibre 适配器能导入 maplibre-gl

const WAIT_TIMEOUT = 10_000;
const CAMERA: CameraState = { center: [118.8, 32.05], zoom: 10, bearing: 0, pitch: 0 };
const SCHOOL_POINTS = QUERY_TOPICS['space-monitoring'].layers[0];
const PARCELS = QUERY_TOPICS['land-change'].layers[1];

const RECTANGLE = polygonOf([
  [118.7, 32.1],
  [118.9, 32.1],
  [118.9, 31.98],
  [118.7, 31.98]
]);

const geometryRequest = (layerCode: string): QueryRequest => ({
  kind: 'geometry',
  layerCode,
  geometry: JSON.stringify(RECTANGLE),
  bounds: [118.7, 31.98, 118.9, 32.1]
});

// 接口返回的形状：点层是点，地类图斑是面
const POINTS: ResultFeatures = [
  { guid: 'a', geom: { type: 'Point', coordinates: [118.75, 32.05] } },
  { guid: 'b', geom: { type: 'Point', coordinates: [118.85, 32.02] } }
];

const AREAS: ResultFeatures = [
  {
    guid: 'c',
    geom: {
      type: 'Polygon',
      coordinates: [
        [
          [118.76, 32.03],
          [118.8, 32.03],
          [118.8, 32.06],
          [118.76, 32.06],
          [118.76, 32.03]
        ]
      ]
    }
  }
];

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${WAIT_TIMEOUT} ms 内没有等到${label}`)), WAIT_TIMEOUT);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 下一次渲染完成；在触发变化之前调用
function nextRender(map: MapLibreMap, label: string): Promise<void> {
  let settle: (() => void) | undefined;
  const settled = new Promise<void>(resolve => {
    settle = () => resolve();
    map.once('idle', settle);
  });
  return withTimeout(settled, label).finally(() => {
    if (settle) {
      map.off('idle', settle);
    }
  });
}

function setup() {
  const container = document.body.appendChild(document.createElement('div'));
  container.style.width = '800px';
  container.style.height = '600px';
  const session = new MapSession({ groups: [RESULT_GROUP, 'draw'], camera: CAMERA });
  const errors: unknown[] = [];
  let created: MapLibreMap | undefined;
  const view = new MapLibreView({
    session,
    container,
    createMap: options => (created = new MapLibreMap(options)),
    onError: error => errors.push(error)
  });
  if (!created) {
    throw new Error('地图没有创建');
  }
  const map = created;
  return {
    session,
    view,
    map,
    errors,
    [Symbol.dispose]() {
      view[Symbol.dispose]();
      session[Symbol.dispose]();
      container.remove();
    }
  };
}

const renderedCount = (map: MapLibreMap, layer: string) => map.queryRenderedFeatures({ layers: [layer] }).length;

describe('数据查询的结果与画的范围', () => {
  it('空间查询命中的点画成红点，画的矩形画出填充和边线', async () => {
    using ctx = setup();
    const { map, session } = ctx;
    await nextRender(map, '首次渲染完成');

    const rendered = nextRender(map, '结果渲染完成');
    session.style.setGroups({
      [RESULT_GROUP]: resultGroup(geometryRequest(SCHOOL_POINTS.table), SCHOOL_POINTS, featureCollection(POINTS), ''),
      draw: drawGroup({ kind: 'rectangle', polygon: RECTANGLE, pixelSize: 0.001 }, null)
    });
    await rendered;

    expect(ctx.errors).toStrictEqual([]);
    expect(ctx.view.state).toBe('ready');
    expect(renderedCount(map, `${RESULT_GROUP}-point`)).toBe(2);
    expect(renderedCount(map, `${RESULT_GROUP}-line`)).toBe(0);
    expect(renderedCount(map, 'draw-fill')).toBeGreaterThan(0);
    expect(renderedCount(map, 'draw-line-completed')).toBeGreaterThan(0);
  });

  it('命中的面画成红色边线，不画成点', async () => {
    using ctx = setup();
    const { map, session } = ctx;
    await nextRender(map, '首次渲染完成');

    const rendered = nextRender(map, '结果渲染完成');
    session.style.setGroup(RESULT_GROUP, resultGroup(geometryRequest(PARCELS.table), PARCELS, featureCollection(AREAS), ''));
    await rendered;

    expect(ctx.errors).toStrictEqual([]);
    expect(renderedCount(map, `${RESULT_GROUP}-line`)).toBeGreaterThan(0);
    expect(renderedCount(map, `${RESULT_GROUP}-point`)).toBe(0);
  });
});
