// @vitest-environment node
import type { Position } from 'geojson';
import { describe, expect, it } from 'vitest';
import { labelCollection, labelPoint, type RegionCollection, thumbnailSvg } from './generate.ts';

const square = (west: number, south: number, size: number): Position[] => [
  [west, south],
  [west + size, south],
  [west + size, south + size],
  [west, south + size],
  [west, south]
];

function regions(...entries: readonly [code: string, name: string, rings: Position[][]][]): RegionCollection {
  return {
    type: 'FeatureCollection',
    features: entries.map(([code, name, rings]) => ({
      type: 'Feature',
      properties: { code, name },
      geometry: { type: 'Polygon', coordinates: rings }
    }))
  };
}

describe('labelPoint', () => {
  it('凹形的面：取面内离边界最远的点，不是落在缺口里的形心', () => {
    // 开口朝右的 C 形：形心落在缺口附近，左边的竖条最宽
    const shape: Position[] = [
      [0, 0],
      [10, 0],
      [10, 2],
      [3, 2],
      [3, 8],
      [10, 8],
      [10, 10],
      [0, 10],
      [0, 0]
    ];

    const [lng = 0] = labelPoint([shape]);

    // 缺口从经度 3 开始；离边界最远的是竖条的中线
    expect(lng).toBeCloseTo(1.5, 1);
  });

  it('避开面里的洞', () => {
    const [lng = 0, lat = 0] = labelPoint([square(0, 0, 10), square(4, 4, 2)]);

    expect(lng >= 4 && lng <= 6 && lat >= 4 && lat <= 6).toBe(false);
  });

  it('矩形落在中间一带，保留 4 位小数', () => {
    const point = labelPoint([square(118, 32, 1)]);

    expect(point[0]).toBe(118.5);
    expect(point[1]).toBeGreaterThan(32.4);
    expect(point[1]).toBeLessThan(32.6);
    expect(point.every(value => Number(value.toFixed(4)) === value)).toBe(true);
  });
});

describe('labelCollection', () => {
  it('市在前、区县在后，各自按代码排序，带上名称和级别', () => {
    const cities = regions(['2', '乙市', [square(5, 0, 1)]], ['1', '甲市', [square(0, 0, 1)]]);
    const counties = regions(['3', '丙县', [square(0, 0, 1)]]);

    const { features } = labelCollection(cities, counties);

    expect(features.map(({ properties }) => properties)).toStrictEqual([
      { name: '甲市', code: '1', level: 'city' },
      { name: '乙市', code: '2', level: 'city' },
      { name: '丙县', code: '3', level: 'county' }
    ]);
  });

  it('同一个代码有几个要素时只出一个地名，放在最大的一块里', () => {
    const cities = regions(['1', '甲市', [square(0, 0, 1)]], ['1', '甲市', [square(10, 10, 4)]]);

    const { features } = labelCollection(cities, regions());

    expect(features).toHaveLength(1);
    expect(features[0]?.geometry.coordinates).toStrictEqual([12, 12]);
  });
});

describe('thumbnailSvg', () => {
  const options = { cityColors: { '1': '#111111', '2': '#222222' }, outsideColor: '#333333', lineColor: '#444444' };
  const cities = regions(['1', '甲市', [square(118, 32, 1)]], ['2', '乙市', [square(119, 32, 1)]]);

  it('省外是底色，每个市按自己的颜色画，市之间是细线', () => {
    const svg = thumbnailSvg(cities, options);

    expect(svg).toContain('fill="#333333"');
    expect(svg).toContain('fill="#111111"');
    expect(svg).toContain('fill="#222222"');
    expect(svg).toContain('stroke="#444444"');
  });

  it('全省高 116、上下居中：放大到 160% 后卡片露出的高度（125）放得下', () => {
    const coordinates = [...thumbnailSvg(cities, options).matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map(match => Number(match[2]));

    expect(Math.min(...coordinates)).toBeCloseTo(42, 0);
    expect(Math.max(...coordinates)).toBeCloseTo(158, 0);
  });

  it('有市没有配色时报错，说出是哪个市', () => {
    expect(() => thumbnailSvg(regions(['9', '丁市', [square(0, 0, 1)]]), options)).toThrow('丁市（9）没有配色');
  });
});
