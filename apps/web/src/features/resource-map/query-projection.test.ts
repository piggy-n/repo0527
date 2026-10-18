// @vitest-environment node
import type { LngLat, ScreenBox, ToolView } from '@yzt/map-core';
import type { Polygon } from 'geojson';
import { describe, expect, it, vi } from 'vitest';
import { clipToScope } from '@/shared/map/region/region-scope';
import { isValidPolygonal, QUERY_VERTEX_LIMIT, vertexCount } from './query-geometry';
import { projectedQueryGeometry, projectedScreenBox } from './query-projection';

// 非线性的可逆投影：四角经纬度直连会偏离屏幕边缘 40 像素
function projection(curve = 1): Pick<ToolView, 'pick' | 'project'> {
  return {
    pick: ({ x, y }) => ({ kind: 'hit', surface: 'ellipsoid', height: 0,
      lngLat: [x / 1000, y / 1000 + curve * (x / 1000) ** 2] }),
    project: ([lng, lat]) => ({ x: lng * 1000, y: (lat - curve * lng ** 2) * 1000 })
  };
}

const BOX: ScreenBox = { from: { x: 100, y: 100 }, to: { x: 500, y: 400 } };

const acrossDateLine: ToolView['pick'] = ({ x, y }) => ({ kind: 'hit', surface: 'ellipsoid', height: 0,
  lngLat: [x < 300 ? 179 : -179, y / 1000] });
const invalidPosition: ToolView['pick'] = () => ({ kind: 'hit', surface: 'ellipsoid', height: 0, lngLat: [NaN, 0] });

// 只在左边界附近放大：范围尺寸不大，但保留六位小数会造成 2.45 像素偏移
const varyingScale = ([lng, lat]: LngLat) => ({
  x: Math.atan((lng - 0.12345649) * 100000) * 50, y: lat * 100
});

function polygonOf(result: ReturnType<typeof projectedScreenBox>): Polygon {
  expect(result.kind).toBe('ready');
  if (result.kind !== 'ready') { throw new Error('应当得到地表多边形'); }
  return result.geometry;
}

describe('三维查询范围的屏幕误差', () => {
  it('细分斜视曲边，发给后端的直线在密采样下仍落在原屏幕矩形 2 像素以内', () => {
    const view = projection();
    const area = polygonOf(projectedScreenBox(BOX, view));
    const result = projectedQueryGeometry(area, 0.001, view);
    expect(result).not.toBeNull();
    expect(result && vertexCount(result)).toBeLessThanOrEqual(QUERY_VERTEX_LIMIT);
    expect(result && isValidPolygonal(result)).toBe(true);
    const ring = area.coordinates[0] ?? [];
    const errors: number[] = [];
    for (let index = 1; index < ring.length; index++) {
      const [ax = 0, ay = 0] = ring[index - 1] ?? [];
      const [bx = 0, by = 0] = ring[index] ?? [];
      for (let sample = 0; sample <= 100; sample++) {
        const ratio = sample / 100;
        const point = view.project([ax + (bx - ax) * ratio, ay + (by - ay) * ratio]);
        expect(point).not.toBeNull();
        if (point) {
          errors.push(Math.min(Math.abs(point.x - 100), Math.abs(point.x - 500),
            Math.abs(point.y - 100), Math.abs(point.y - 400)));
        }
      }
    }
    expect(Math.max(...errors)).toBeLessThanOrEqual(2);
    expect(projectedScreenBox({ from: BOX.to, to: BOX.from }, view)).toEqual({ kind: 'ready', geometry: area });
  });

  it('区划裁剪产生的内部边界也参与比较，不要求它们贴着原来的屏幕框', () => {
    const view = projection();
    const area = polygonOf(projectedScreenBox(BOX, view));
    const scope: Polygon = { type: 'Polygon', coordinates: [
      [[0.2, 0], [0.4, 0], [0.4, 1], [0.2, 1], [0.2, 0]],
      [[0.25, 0.25], [0.3, 0.25], [0.3, 0.3], [0.25, 0.3], [0.25, 0.25]]
    ] };
    const clipped = clipToScope(area, scope);
    expect(clipped).not.toBeNull();
    const result = clipped && projectedQueryGeometry(clipped, 0.001, view);
    expect(result).not.toBeNull();
    expect(result && isValidPolygonal(result)).toBe(true);
  });

  it('角点、需要细分的边缘拾取失败都明确拒绝，不用剩余三个角补成范围', () => {
    const view = projection();
    for (const missing of [{ x: 500, y: 400 }, { x: 300, y: 100 }]) {
      const pick: ToolView['pick'] = point => point.x === missing.x && point.y === missing.y
        ? { kind: 'miss' } : view.pick(point);
      expect(projectedScreenBox(BOX, { ...view, pick })).toEqual({ kind: 'query-unavailable', reason: 'surface' });
    }
  });

  it('跨经线、退化范围、非有限坐标和过大的屏幕边界不会变成后端查询', () => {
    const view = projection(0);
    expect(projectedScreenBox(BOX, { ...view, pick: acrossDateLine })).toMatchObject({ reason: 'geometry' });
    expect(projectedScreenBox({ from: BOX.from, to: BOX.from }, view)).toMatchObject({ reason: 'geometry' });
    expect(projectedScreenBox({ from: { x: NaN, y: 0 }, to: BOX.to }, view)).toMatchObject({ reason: 'geometry' });
    expect(projectedScreenBox(BOX, { ...view, pick: invalidPosition })).toMatchObject({ reason: 'geometry' });
    expect(projectedScreenBox({ from: { x: 0, y: 0 }, to: { x: 4096, y: 4096 } }, view))
      .toMatchObject({ reason: 'geometry' });
  });

  it('舍入误差在近处超过预算时拒绝，不能仅凭中心像素的经纬度大小通过', () => {
    const area: Polygon = { type: 'Polygon', coordinates: [[
      [0.12345649, 0.1], [0.2, 0.1], [0.2, 0.2], [0.12345649, 0.2], [0.12345649, 0.1]
    ]] };
    const view = { ...projection(0), project: varyingScale };
    expect(projectedQueryGeometry(area, 0.01, view)).toBeNull();
  });

  it('投影不到或细分不收敛时工作量有上限', () => {
    const view = projection();
    const project = vi.fn<ToolView['project']>(() => null);
    expect(projectedScreenBox(BOX, { ...view, project })).toMatchObject({ reason: 'geometry' });
    expect(project.mock.calls.length).toBeLessThan(100);
    const area = polygonOf(projectedScreenBox(BOX, view));
    expect(projectedQueryGeometry(area, 0.001, { ...view, project })).toBeNull();
  });
});
