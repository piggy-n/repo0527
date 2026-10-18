// @vitest-environment node
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { describe, expect, it } from 'vitest';
import { createMvtFixture, mvtFixtureUrl } from './mvt-fixture';

describe('本地合成 MVT 夹具', () => {
  it('两个来源层保留独立 extent、原生身份和多种属性', () => {
    const tile = new VectorTile(new PbfReader(createMvtFixture()));
    expect(Object.keys(tile.layers)).toEqual(['landuse', 'detail']);
    expect(tile.layers.landuse.extent).toBe(4096);
    expect(tile.layers.detail.extent).toBe(8192);
    expect(tile.layers.landuse.length).toBe(2);
    expect(tile.layers.detail.length).toBe(3);
    expect(tile.layers.landuse.feature(0)).toMatchObject({
      id: 11, type: 3, properties: { category: 'primary', bsm: 'area-primary', enabled: true, rank: 7 }
    });
    expect(tile.layers.landuse.feature(1).properties).toEqual({ category: 'secondary', bsm: 'area-secondary' });
    expect(tile.layers.detail.feature(1)).toMatchObject({
      id: 22, type: 1, properties: { category: 'secondary', guid: 'points-secondary' }
    });
  });

  it('孔洞按相反绕向闭合，点、线与瓦片外的 buffer 坐标都可解码', () => {
    const tile = new VectorTile(new PbfReader(createMvtFixture()));
    const polygon = tile.layers.landuse.feature(0).loadGeometry();
    expect(polygon).toHaveLength(2);
    expect(polygon[0].map(({ x, y }) => [x, y])).toEqual([
      [256, 256], [3072, 256], [3072, 3584], [256, 3584], [256, 256]
    ]);
    expect(polygon[1].map(({ x, y }) => [x, y])).toEqual([
      [1280, 1280], [1280, 2560], [2304, 2560], [2304, 1280], [1280, 1280]
    ]);
    expect(tile.layers.landuse.feature(0).toGeoJSON(0, 0, 0).geometry.type).toBe('Polygon');
    expect(tile.layers.detail.feature(1).loadGeometry().flat().map(({ x, y }) => [x, y])).toEqual([
      [2048, 4096], [6144, 4096]
    ]);
    expect(tile.layers.detail.feature(2).loadGeometry()[0].map(({ x, y }) => [x, y])).toEqual([
      [-1024, 4096], [9216, 4096]
    ]);
  });

  it('独立二进制缓冲与 data URL 提供相同的合成数据', async () => {
    const first = createMvtFixture();
    const second = createMvtFixture();
    expect(second).not.toBe(first);
    expect(second.buffer).not.toBe(first.buffer);
    expect(second).toEqual(first);
    const response = await fetch(mvtFixtureUrl());
    expect(response.ok).toBe(true);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(first);
  });
});
