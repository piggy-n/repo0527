// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { gridProjection, projectionDefinition } from './projection.ts';

describe('projectionDefinition', () => {
  it('EPSG:4548 是中央经线 117°E、不带带号的 3 度带', () => {
    expect(projectionDefinition(4548)).toContain('+lon_0=117 ');
    expect(projectionDefinition(4548)).toContain('+x_0=500000 ');
    expect(projectionDefinition(4534)).toContain('+lon_0=75 ');
    expect(projectionDefinition(4554)).toContain('+lon_0=135 ');
  });

  it('其他编号报错', () => {
    expect(() => projectionDefinition(4533)).toThrow('EPSG:4533');
    expect(() => projectionDefinition(4555)).toThrow('EPSG:4555');
    expect(() => projectionDefinition(4326)).toThrow('EPSG:4326');
  });
});

describe('gridProjection', () => {
  const projection = gridProjection(4548);

  it('中央经线上：经度 117°，网格东向就是正东', () => {
    const [lng] = projection.toLngLat(500000, 3793605);
    expect(lng).toBeCloseTo(117, 9);
    expect(projection.gridEastHeading(500000, 3793605)).toBeCloseTo(0, 6);
  });

  it('楚王山1号的 offset：和 L.1 用 proj4 换算的一致（ADR 0149 第 4 节）', () => {
    const [lng, lat] = projection.toLngLat(505745.458968483, 3793605.533563799);
    expect(lng).toBeCloseTo(117.0623886, 7);
    expect(lat).toBeCloseTo(34.2699335, 7);
    expect(projection.gridEastHeading(505745.458968483, 3793605.533563799)).toBeCloseTo(-0.035, 3);
  });

  it('子午线收敛角：中央经线以东是负的、以西是正的，大小约为经差乘纬度的正弦', () => {
    const east = 516641.639074399;
    const north = 3793143.664240893;
    const [lng, lat] = projection.toLngLat(east, north);
    const expected = (lng - 117) * Math.sin((lat * Math.PI) / 180);
    expect(projection.gridEastHeading(east, north)).toBeCloseTo(-expected, 4);
    expect(projection.gridEastHeading(1000000 - east, north)).toBeCloseTo(expected, 4);
  });
});
