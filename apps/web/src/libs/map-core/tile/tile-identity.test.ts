// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { nativeTileCoordinate, tileDataKey, tileSourceKey, type TileDataSource } from './tile-identity';

const SOURCE: TileDataSource = {
  tiles: ['https://a.test/2024/{z}/{x}/{y}.pbf', 'https://b.test/2024/{z}/{x}/{y}.pbf'],
  dataVersion: 'v1', permissionScope: 'account:one'
};

describe('瓦片身份', () => {
  it('原生范围内沿用坐标，超采样兄弟共享父瓦片，不经过 32 位移位', () => {
    expect(nativeTileCoordinate({ z: 6, x: 32, y: 17 }, 12)).toEqual({ z: 6, x: 32, y: 17 });
    expect(nativeTileCoordinate({ z: 15, x: 17413, y: 9201 }, 12)).toEqual({ z: 12, x: 2176, y: 1150 });
    expect(nativeTileCoordinate({ z: 30, x: 2 ** 30 - 1, y: 2 ** 30 - 2 }, 0)).toEqual({ z: 0, x: 0, y: 0 });
  });

  it('缓存身份包括全部模板、数据版本、权限范围、scheme 和坐标', () => {
    const coordinate = { z: 1, x: 1, y: 0 };
    const key = tileDataKey(SOURCE, coordinate);
    expect(tileDataKey({ ...SOURCE, scheme: 'xyz' }, coordinate)).toBe(key);
    expect(tileDataKey({ ...SOURCE, tiles: [...SOURCE.tiles] }, coordinate)).toBe(key);
    for (const source of [
      { ...SOURCE, tiles: SOURCE.tiles.toReversed() },
      { ...SOURCE, tiles: ['https://a.test/2025/{z}/{x}/{y}.pbf'] },
      { ...SOURCE, dataVersion: 'v2' },
      { ...SOURCE, permissionScope: 'account:two' },
      { ...SOURCE, scheme: 'tms' as const }
    ]) {
      expect(tileDataKey(source, coordinate)).not.toBe(key);
    }
    expect(tileDataKey(SOURCE, { ...coordinate, y: 1 })).not.toBe(key);
  });

  it('结构化身份避免不同字段中的分隔符产生碰撞', () => {
    expect(tileSourceKey({ ...SOURCE, dataVersion: 'a/b', permissionScope: 'c' }))
      .not.toBe(tileSourceKey({ ...SOURCE, dataVersion: 'a', permissionScope: 'b/c' }));
  });

  it.each([
    { z: -1, x: 0, y: 0 }, { z: 31, x: 0, y: 0 }, { z: 1.5, x: 0, y: 0 },
    { z: 1, x: 2, y: 0 }, { z: 1, x: -1, y: 0 }, { z: 1, x: 0, y: NaN }
  ])('非法坐标明确拒绝：%j', coordinate => {
    expect(() => tileDataKey(SOURCE, coordinate)).toThrow(RangeError);
    expect(() => nativeTileCoordinate(coordinate, 10)).toThrow(RangeError);
  });

  it('拒绝非法最大级别和空模板', () => {
    expect(() => nativeTileCoordinate({ z: 0, x: 0, y: 0 }, 1.5)).toThrow(RangeError);
    expect(() => tileSourceKey({ ...SOURCE, tiles: [] })).toThrow(TypeError);
    expect(() => tileSourceKey({ ...SOURCE, tiles: [' '] })).toThrow(TypeError);
  });
});
