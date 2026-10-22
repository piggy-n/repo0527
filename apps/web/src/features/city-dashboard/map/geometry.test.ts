// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CITIES } from '../catalog';
import { prepareRegions, type RegionGeometry } from './region-geometry';
import { layoutMapLabels } from './label-layout';

// 最小边界仍覆盖全部城市，额外小面和孔洞用于防止几何丢失
function boundaries(): RegionGeometry[] {
  return CITIES.map((city, index) => {
    const x = 118 + index * .1;
    return { code: city.code, geometry: { type: 'Polygon', coordinates: [
      [[x, 32], [x + .08, 32], [x + .08, 32.08], [x, 32.08], [x, 32]],
      [[x + .02, 32.02], [x + .02, 32.04], [x + .04, 32.04], [x + .04, 32.02], [x + .02, 32.02]]
    ] } };
  });
}

describe('驾驶舱地图几何', () => {
  it('聚合同市离散面并保留孔洞，不修改共享边界', () => {
    const source = boundaries();
    source.push({ code: CITIES[0].code, geometry: { type: 'MultiPolygon', coordinates: [
      [[[119.8, 33], [119.9, 33], [119.9, 33.1], [119.8, 33.1], [119.8, 33]]]
    ] } });
    const before = JSON.stringify(source);
    const result = prepareRegions(source);
    expect(result.regions).toHaveLength(13);
    expect(result.regions[0].shapes).toHaveLength(2);
    expect(result.regions[0].shapes[0].holes).toHaveLength(1);
    expect(result.featureCollection.features[0].geometry.coordinates).toHaveLength(2);
    const points = result.regions.flatMap(region => region.shapes.flatMap(shape => shape.getPoints()));
    const extent = Math.max(
      Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x)),
      Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y))
    );
    expect(extent).toBeCloseTo(270);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('缺少城市边界时明确失败，不展示不完整省域', () => {
    expect(() => prepareRegions(boundaries().slice(1))).toThrow('南京市边界缺失');
  });

  it('悬浮仅移动当前标签，不改变邻市避让位置', () => {
    const positions = CITIES.slice(0, 3).map(city => ({ code: city.code, name: city.name, x: 200, y: 200, offsetX: 0, offsetY: 0 }));
    const before = layoutMapLabels(positions, 900, 700);
    const hovered = structuredClone(positions);
    hovered[0].offsetY = -8;
    const after = layoutMapLabels(hovered, 900, 700);
    expect(after.labels.slice(1)).toEqual(before.labels.slice(1));
    expect(after.labels[0].y).toBe(before.labels[0].y - 8);
    for (const label of before.labels) {
      expect(label.x).toBeGreaterThanOrEqual(label.halfWidth);
      expect(label.y).toBeGreaterThanOrEqual(label.halfHeight);
    }
    expect(new Set(before.labels.map(label => `${label.x},${label.y}`)).size).toBe(3);
  });

  it('窄屏密集锚点可使用外围空位，不把标签放回冲突位置', () => {
    const positions = CITIES.map(city => ({ code: city.code, name: city.name, x: 180, y: 190, offsetX: 0, offsetY: 0 }));
    const { labels } = layoutMapLabels(positions, 366, 345);
    const collisions = labels.flatMap((a, index) => labels.slice(index + 1).filter(b =>
      Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth && Math.abs(a.y - b.y) < a.halfHeight + b.halfHeight));
    expect(collisions).toHaveLength(0);
  });
});
