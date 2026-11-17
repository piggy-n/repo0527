// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  SERVER_BASEMAP_OPTIONS,
  SERVER_BASEMAP_PROBE_TILE,
  SERVER_BASEMAP_PROBE_TIMEOUT
} from './server-basemap-options';

// 一块 XYZ 瓦片的经纬度范围（Web 墨卡托）
function tileBounds(z: number, x: number, y: number) {
  const lng = (column: number) => (column / 2 ** z) * 360 - 180;
  const lat = (row: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / 2 ** z))) * 180) / Math.PI;
  return { west: lng(x), east: lng(x + 1), north: lat(y), south: lat(y + 1) };
}

describe('SERVER_BASEMAP_OPTIONS（ADR 0165 第 2 节）', () => {
  it('按 ADR 的表格排：标准、影像、黑色、极夜蓝；ID 和地址前缀都不重复', () => {
    const ids = SERVER_BASEMAP_OPTIONS.map(option => option.id);
    const prefixes = SERVER_BASEMAP_OPTIONS.map(option => option.prefix);

    expect(ids).toStrictEqual(['standard', 'imagery', 'black', 'night-blue']);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    // 中文目录名只在 nginx 配置里，前缀是一段 ASCII
    for (const prefix of prefixes) {
      expect(prefix).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('都是 7～18 级；影像叠静态地名，三套矢量的地名印在图上', () => {
    const rows = SERVER_BASEMAP_OPTIONS.map(({ id, minzoom, maxzoom, labels }) => [id, minzoom, maxzoom, labels]);
    expect(rows).toStrictEqual([
      ['standard', 7, 18, 'baked'],
      ['imagery', 7, 18, 'static'],
      ['black', 7, 18, 'baked'],
      ['night-blue', 7, 18, 'baked']
    ]);
  });

  it('范围是合法的经纬度，包住江苏，也包住探测读的那块瓦片', () => {
    const { z, x, y } = SERVER_BASEMAP_PROBE_TILE;
    const tile = tileBounds(z, x, y);

    for (const { id, bounds } of SERVER_BASEMAP_OPTIONS) {
      const [west, south, east, north] = bounds;
      expect({ id, ordered: west < east && south < north }).toStrictEqual({ id, ordered: true });
      expect([west, south, east, north]).toStrictEqual([
        expect.closeTo(116.3, 0),
        expect.closeTo(30.75, 0),
        expect.closeTo(122.2, 0),
        expect.closeTo(35.2, 0)
      ]);
      const containsTile = west <= tile.west && east >= tile.east && south <= tile.south && north >= tile.north;
      expect({ id, containsTile }).toStrictEqual({ id, containsTile: true });
    }
    // 南京主城
    expect(tile.west).toBeCloseTo(118.48, 2);
    expect(tile.north).toBeCloseTo(32.25, 2);
  });

  it('探测最多等 3 秒', () => {
    expect(SERVER_BASEMAP_PROBE_TIMEOUT).toBe(3000);
  });
});
