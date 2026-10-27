// @vitest-environment node
import type { Feature, FeatureCollection, GeoJSON, Geometry, GeoJsonProperties, LineString, Position } from 'geojson';
import { describe, expect, it } from 'vitest';
import {
  blurredOpacity,
  cleanPath,
  dashPattern,
  isGeoJson,
  type LineShape,
  type OverlayLayerSpecification,
  type OverlayShape,
  type OverlaySpec,
  planOverlays,
  type PointShape,
  type PolygonShape,
  shrinkWorldRing,
  simplifyPath,
  simplifyTolerance
} from './overlay-plan';

const SQUARE: Position[] = [
  [118, 32],
  [119, 32],
  [119, 33],
  [118, 33],
  [118, 32]
];

// 一条锯齿线：起伏 0.001°，6 级的容差约 0.0055°
const ZIGZAG: Position[] = Array.from({ length: 101 }, (_, index) => [118 + index * 0.01, 32 + (index % 2) * 0.001]);

const feature = (geometry: Geometry, properties: GeoJsonProperties = {}): Feature => ({
  type: 'Feature',
  properties,
  geometry
});

const lineString = (...coordinates: Position[]): LineString => ({ type: 'LineString', coordinates });

// 线图层，ID 和数据源同名
const lineLayer = (id: string, extra: Partial<OverlayLayerSpecification>): OverlayLayerSpecification =>
  ({ id, type: 'line', source: id, ...extra }) as OverlayLayerSpecification;

function spec(layer: OverlayLayerSpecification, data: GeoJSON | string, order = 0): OverlaySpec {
  return { layer, order, sourceId: layer.source, data };
}

function collection(...features: FeatureCollection['features']): FeatureCollection {
  return { type: 'FeatureCollection', features };
}

// 数据就是 spec 里的内联数据
const inline = ({ data }: OverlaySpec) => (typeof data === 'string' ? undefined : data);

function shapesOf(specs: readonly OverlaySpec[], zoom = 9): readonly OverlayShape[] {
  return planOverlays(specs, inline, zoom).flatMap(({ shapes }) => shapes);
}

function only<S extends OverlayShape>(shapes: readonly OverlayShape[], kind: S['kind']): S[] {
  return shapes.filter((shape): shape is S => shape.kind === kind);
}

describe('planOverlays', () => {
  it('线图层按取整后的级别求值线宽，颜色带上不透明度；面要素画出每个环', () => {
    const layer: OverlayLayerSpecification = {
      id: 'boundary-city',
      type: 'line',
      source: 'boundary-city',
      paint: {
        'line-color': '#597EF7',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 13, 3],
        'line-opacity': 0.5
      }
    };
    const data = collection({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [SQUARE, SQUARE.map(([lng = 0, lat = 0]) => [lng + 0.2, lat + 0.2])] }
    });

    // 8.6 取整为 9：线宽是 5 级的 1 和 13 级的 3 中间的 2
    const lines = only<LineShape>(shapesOf([spec(layer, data)], 8.6), 'line');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ width: 2, dash: null, path: SQUARE });
    const [r, g, b, a] = lines[0]?.color ?? [];
    expect([r, g, b].map(value => Math.round((value ?? 0) * 255))).toStrictEqual([89, 126, 247]);
    expect(a).toBe(0.5);
  });

  it('过滤条件按要素属性和几何类型求值，和二维一样', () => {
    const drawing: OverlayLayerSpecification = {
      id: 'measure-drawing',
      type: 'line',
      source: 'measure',
      filter: ['==', ['get', 'status'], 'drawing'],
      paint: { 'line-dasharray': [2, 2], 'line-width': 2 }
    };
    const polygons: OverlayLayerSpecification = {
      id: 'measure-area',
      type: 'fill',
      source: 'measure',
      filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
    };
    const data = collection(
      feature(lineString([118, 32], [119, 33]), { status: 'drawing' }),
      feature(lineString([118, 31], [119, 31]), { status: 'completed' }),
      { type: 'Feature', properties: { status: 'drawing' }, geometry: { type: 'Polygon', coordinates: [SQUARE] } }
    );

    const shapes = shapesOf([spec(drawing, data), spec(polygons, data)]);

    // 线图层：两个 drawing 要素，一条线和面的一个环；面图层只有面
    expect(only<LineShape>(shapes, 'line').map(({ path }) => path.length)).toStrictEqual([2, 5]);
    expect(only<LineShape>(shapes, 'line')[0]?.dash).toStrictEqual({ length: 8, pattern: 0b0000000011111111 });
    expect(only<PolygonShape>(shapes, 'polygon')).toHaveLength(1);
  });

  it('面图层的颜色乘上不透明度，洞照样保留', () => {
    const layer: OverlayLayerSpecification = {
      id: 'region',
      type: 'fill',
      source: 'region',
      paint: { 'fill-color': 'rgba(0, 0, 255, 0.5)', 'fill-opacity': 0.4 }
    };
    const hole = SQUARE.map(([lng = 0, lat = 0]) => [lng * 0.5 + 59.2, lat * 0.5 + 16.2]);
    const data = collection(feature({ type: 'Polygon', coordinates: [SQUARE, hole] }));

    const [polygon] = only<PolygonShape>(shapesOf([spec(layer, data)]), 'polygon');

    expect(polygon?.rings).toStrictEqual([SQUARE, hole]);
    expect(polygon?.color).toStrictEqual([0, 0, 1, 0.2]);
  });

  it('圆点图层只画点要素：半径、描边和描边颜色', () => {
    const layer: OverlayLayerSpecification = {
      id: 'vertex',
      type: 'circle',
      source: 'measure',
      paint: {
        'circle-radius': 3,
        'circle-color': '#ff0000',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2
      }
    };
    const data = collection(
      { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: [[118, 32], [119, 33]] } },
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[118, 32], [119, 33]] } }
    );

    const points = only<PointShape>(shapesOf([spec(layer, data)]), 'point');

    expect(points.map(({ position }) => position)).toStrictEqual([[118, 32], [119, 33]]);
    expect(points[0]).toMatchObject({ radius: 3, strokeWidth: 2, color: [1, 0, 0, 1], strokeColor: [1, 1, 1, 1] });
  });

  it('隐藏的、级别范围外的、数据还没到的图层不画；看不见的形状不出现', () => {
    const data = collection(feature(lineString([118, 32], [119, 33])));

    const layers = planOverlays(
      [
        spec(lineLayer('hidden', { layout: { visibility: 'none' } }), data),
        spec(lineLayer('zoomed', { minzoom: 12 }), data),
        spec(lineLayer('remote', {}), '/boundary.json'),
        spec(lineLayer('transparent', { paint: { 'line-opacity': 0 } }), data),
        spec(lineLayer('shown', { maxzoom: 10 }), data, 4)
      ],
      inline,
      9.4
    );

    expect(layers.map(({ id, order, shapes }) => [id, order, shapes.length])).toStrictEqual([
      ['transparent', 0, 0],
      ['shown', 4, 1]
    ]);
  });

  it('线宽、颜色写错时取默认值，不影响别的属性', () => {
    const layer = {
      id: 'broken',
      type: 'line',
      source: 'broken',
      paint: { 'line-width': ['no-such-operator'], 'line-color': '#00ff00' }
    } as unknown as OverlayLayerSpecification;
    const data = collection(feature(lineString([118, 32], [119, 33])));

    const [line] = only<LineShape>(shapesOf([spec(layer, data)]), 'line');

    expect(line).toMatchObject({ width: 1, color: [0, 1, 0, 1] });
  });

  it('区划遮罩：外环是整个世界的面收成洞的包围盒放大后的方框，洞不变', () => {
    const world: Position[] = [
      [-180, -85.051129],
      [180, -85.051129],
      [180, 85.051129],
      [-180, 85.051129],
      [-180, -85.051129]
    ];
    const layer: OverlayLayerSpecification = { id: 'region-clip-mask', type: 'fill', source: 'region-clip' };
    const data = feature({ type: 'MultiPolygon', coordinates: [[world, SQUARE]] });

    const [mask] = only<PolygonShape>(shapesOf([spec(layer, data)]), 'polygon');

    expect(mask?.rings[1]).toStrictEqual(SQUARE);
    // 包围盒 1°×1°，向四周扩大 5°（大于 4 倍的 4°）
    expect(mask?.rings[0]).toStrictEqual([
      [113, 27],
      [124, 27],
      [124, 38],
      [113, 38],
      [113, 27]
    ]);
  });
});

describe('shrinkWorldRing', () => {
  it('包围盒很大时按 4 倍扩大，夹在安全的经纬度范围里；不是整个世界的面原样返回', () => {
    const world: Position[] = [
      [-180, -80],
      [180, -80],
      [180, 80],
      [-180, 80],
      [-180, -80]
    ];
    const wide: Position[] = [
      [100, 10],
      [140, 10],
      [140, 50],
      [100, 50],
      [100, 10]
    ];

    expect(shrinkWorldRing([world, wide])[0]).toStrictEqual([
      [-60, -85.051129],
      [179.9, -85.051129],
      [179.9, 85.051129],
      [-60, 85.051129],
      [-60, -85.051129]
    ]);
    expect(shrinkWorldRing([world])[0]?.[1]).toStrictEqual([179.9, -85.051129]);
    expect(shrinkWorldRing([SQUARE])).toStrictEqual([SQUARE]);
  });
});

describe('simplifyTolerance、simplifyPath', () => {
  it('容差是这一级的半个像素：0 级 360 / 512 / 2 度，每高一级减半', () => {
    expect(simplifyTolerance(0)).toBe(360 / 512 / 2);
    expect(simplifyTolerance(7)).toBe(simplifyTolerance(6) / 2);
  });

  it('容差以内的起伏去掉，拐角、首尾保留；不到 3 个点的不变', () => {
    const corner: Position[] = [[118, 32], [119, 32], [119, 33]];

    expect(simplifyPath(ZIGZAG, simplifyTolerance(6))).toStrictEqual([ZIGZAG[0], ZIGZAG[100]]);
    expect(simplifyPath(corner, simplifyTolerance(6))).toStrictEqual(corner);
    expect(simplifyPath([[118, 32], [119, 33]], 1)).toStrictEqual([[118, 32], [119, 33]]);
  });

  it('推导时按级别简化：低级别点少，高级别保留细节', () => {
    const layer: OverlayLayerSpecification = { id: 'line', type: 'line', source: 'line' };
    const data = collection(feature(lineString(...ZIGZAG)));
    const points = (zoom: number) => only<LineShape>(shapesOf([spec(layer, data)], zoom), 'line')[0]?.path.length;

    expect(points(6)).toBe(2);
    expect(points(14)).toBe(101);
  });
});

describe('cleanPath', () => {
  it('去掉相邻的重复点和不是有限数的点；不相邻的重复点保留', () => {
    const path: Position[] = [[118, 32], [118, 32], [118 + 1e-12, 32], [Number.NaN, 1], [119, 33], [118, 32]];

    expect(cleanPath(path)).toStrictEqual([[118, 32], [119, 33], [118, 32]]);
  });

  it('坐标少一层嵌套时跳过，不抛错', () => {
    const malformed = [118, 32] as unknown as Position[];

    expect(cleanPath(malformed)).toStrictEqual([]);
  });

  it('去重后不够画的线和环丢掉', () => {
    const layer: OverlayLayerSpecification = { id: 'line', type: 'line', source: 'line' };
    const data = collection(feature(lineString([118, 32], [118, 32])));

    expect(shapesOf([spec(layer, data)])).toStrictEqual([]);
  });
});

describe('dashPattern', () => {
  it('周期是线宽乘以虚实之和，16 格按虚实比例排；周期至少 4 像素', () => {
    // [3, 2]：前 10 格（3/5 的 16 格取整到格子中点）是实线
    expect(dashPattern([3, 2], 2)).toStrictEqual({ length: 10, pattern: 0b0000001111111111 });
    expect(dashPattern([1, 1], 1)).toStrictEqual({ length: 4, pattern: 0b0000000011111111 });
  });

  it('不是成对的虚实、总长为 0 时没有虚线', () => {
    expect(dashPattern([2], 1)).toBeNull();
    expect(dashPattern([0, 0], 1)).toBeNull();
  });
});

describe('blurredOpacity', () => {
  it('按线宽 / (线宽 + 模糊) 降低不透明度；没有模糊时不变', () => {
    expect(blurredOpacity(0.8, 8, 5)).toBeCloseTo((0.8 * 8) / 13);
    expect(blurredOpacity(0.8, 8, 0)).toBe(0.8);
  });
});

describe('isGeoJson', () => {
  it('认得要素集合、要素和几何，结构不对的不算', () => {
    expect(isGeoJson(collection())).toBe(true);
    expect(isGeoJson({ type: 'Feature', properties: {}, geometry: null })).toBe(true);
    expect(isGeoJson({ type: 'Point', coordinates: [1, 2] })).toBe(true);
    expect(isGeoJson({ type: 'FeatureCollection', features: 'oops' })).toBe(false);
    expect(isGeoJson({ type: 'FeatureCollection', features: [{ type: 'Point' }] })).toBe(false);
    expect(isGeoJson('<!doctype html>')).toBe(false);
  });
});
