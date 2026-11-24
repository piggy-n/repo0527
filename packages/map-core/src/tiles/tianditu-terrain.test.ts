// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  decodeTiandituTerrain,
  encodeTerrarium,
  type FetchTerrainTile,
  tiandituTerrainUrl,
  TiandituTerrainReader
} from './tianditu-terrain';

const SAMPLES = 150;

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Response(stream).arrayBuffer();
}

// 一块瓦片的原始数据：150×150 个小端 int16，行优先、第 0 行在北
function tileBytes(height: (row: number, column: number) => number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(SAMPLES * SAMPLES * 2);
  const view = new DataView(bytes.buffer);
  for (let row = 0; row < SAMPLES; row++) {
    for (let column = 0; column < SAMPLES; column++) {
      view.setInt16((row * SAMPLES + column) * 2, height(row, column), true);
    }
  }
  return bytes;
}

// 线性的地形：双线性插值在一块瓦片里没有误差，只差存成整数的 0.5 米
const terrain = (lng: number, lat: number) => 100 + (lng - 117) * 1000 + (lat - 34) * 500;

// 按地址里的级别、瓦片号生成线性地形的瓦片，记下请求过的地址
function fakeServer(options: { readonly missing?: (x: number, y: number) => boolean } = {}) {
  const requested: string[] = [];
  const fetchTile: FetchTerrainTile = async url => {
    requested.push(url);
    const params = new URL(url).searchParams;
    const [x, y, level] = ['x', 'y', 'l'].map(name => Number(params.get(name)));
    if (options.missing?.(x, y)) {
      return null;
    }
    const size = 360 / 2 ** level;
    return deflate(
      tileBytes((row, column) =>
        Math.round(terrain(-180 + (x + column / (SAMPLES - 1)) * size, 90 - (y + row / (SAMPLES - 1)) * size))
      )
    );
  };
  return { requested, fetchTile };
}

const signal = () => new AbortController().signal;

describe('decodeTiandituTerrain', () => {
  it('解压成 150×150 个高度：保留负数，超出 -2000～10000 的当 0（同官方插件）', async () => {
    const values = [-50, 10001, -2001, 35];
    const heights = await decodeTiandituTerrain(await deflate(tileBytes((row, column) => values[(row + column) % 4])));

    expect(heights).toHaveLength(SAMPLES * SAMPLES);
    expect(Array.from(heights.subarray(0, 4))).toStrictEqual([-50, 0, 0, 35]);
  });

  it('不是压缩数据时报错，带上服务器给的文字；解压后大小不对也报错', async () => {
    const text = new TextEncoder().encode('{"msg":"权限类型错误"}');

    await expect(decodeTiandituTerrain(text.buffer)).rejects.toThrow('权限类型错误');
    await expect(decodeTiandituTerrain(await deflate(new Uint8Array(100)))).rejects.toThrow('应为 45000');
  });
});

describe('tiandituTerrainUrl', () => {
  it('按 x + y 轮流用 t0～t7，带上级别和 key', () => {
    expect(tiandituTerrainUrl('k e y', 12, 3381, 1100)).toBe(
      'https://t1.tianditu.gov.cn/mapservice/swdx?T=elv_c&x=3381&y=1100&l=12&tk=k%20e%20y'
    );
  });
});

describe('TiandituTerrainReader', () => {
  it('取高度：按 12 级的瓦片双线性插值；同一块只下载一次', async () => {
    const server = fakeServer();
    const reader = new TiandituTerrainReader({ key: 'key', fetchTile: server.fetchTile });

    const [a, b] = await Promise.all([
      reader.heightAt(117.18, 34.266, signal()),
      reader.heightAt(117.1801, 34.2661, signal())
    ]);

    expect(Math.abs(a - terrain(117.18, 34.266))).toBeLessThan(0.6);
    expect(Math.abs(b - terrain(117.1801, 34.2661))).toBeLessThan(0.6);
    expect(server.requested).toHaveLength(1);
    expect(new URL(server.requested[0]).searchParams.get('l')).toBe('12');
  });

  it('瓦片不存在（404）时高度是 0', async () => {
    const reader = new TiandituTerrainReader({ key: 'key', fetchTile: fakeServer({ missing: () => true }).fetchTile });

    expect(await reader.heightAt(117.18, 34.266, signal())).toBe(0);
  });

  it('失败的不缓存：下次再要时重新下载', async () => {
    let calls = 0;
    const server = fakeServer();
    const reader = new TiandituTerrainReader({
      key: 'key',
      fetchTile: async (url, abort) => {
        calls++;
        if (calls === 1) {
          throw new Error('HTTP 429');
        }
        return server.fetchTile(url, abort);
      }
    });

    await expect(reader.heightAt(117.18, 34.266, signal())).rejects.toThrow('HTTP 429');
    expect(Math.abs((await reader.heightAt(117.18, 34.266, signal())) - terrain(117.18, 34.266))).toBeLessThan(0.6);
    expect(calls).toBe(2);
  });

  it('调用方中止只结束自己的等待：共用的下载照常完成，别的调用方拿到结果', async () => {
    const server = fakeServer();
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const reader = new TiandituTerrainReader({
      key: 'key',
      fetchTile: async (url, abort) => {
        await gate;
        return server.fetchTile(url, abort);
      }
    });
    const controller = new AbortController();
    const aborted = reader.heightAt(117.18, 34.266, controller.signal);
    const kept = reader.heightAt(117.18, 34.266, signal());

    controller.abort();
    release?.();

    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    expect(Math.abs((await kept) - terrain(117.18, 34.266))).toBeLessThan(0.6);
    expect(server.requested).toHaveLength(1);
  });

  it('墨卡托瓦片：经度边界和天地图同一级对齐，只用同一列的瓦片；第 i 个采样在瓦片的 i/size 处', async () => {
    const server = fakeServer();
    const reader = new TiandituTerrainReader({ key: 'key', fetchTile: server.fetchTile });
    const z = 12;
    const x = Math.floor(((117.18 + 180) / 360) * 2 ** z);
    const latitude = (34.266 * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2) * 2 ** z);
    const size = 64;

    const heights = await reader.mercatorTile(z, x, y, size, signal());

    expect(heights).toHaveLength(size * size);
    expect(server.requested.length).toBeGreaterThanOrEqual(1);
    expect(server.requested.length).toBeLessThanOrEqual(2);
    expect(server.requested.every(url => new URL(url).searchParams.get('x') === String(x))).toBe(true);
    const at = (row: number, column: number) => {
      const lng = ((x + column / size) / 2 ** z) * 360 - 180;
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + row / size)) / 2 ** z))) * 180) / Math.PI;
      return terrain(lng, lat);
    };
    for (const [row, column] of [
      [0, 0],
      [32, 17],
      [63, 63]
    ]) {
      expect(Math.abs(heights[row * size + column] - at(row, column))).toBeLessThan(0.6);
    }
  });

  it('墨卡托的级别夹到有数据的 6～12 级：放大时用 12 级的瓦片', async () => {
    const server = fakeServer();
    const reader = new TiandituTerrainReader({ key: 'key', fetchTile: server.fetchTile });

    await reader.mercatorTile(14, 13524, 6604, 8, signal());

    expect(server.requested.every(url => new URL(url).searchParams.get('l') === '12')).toBe(true);
  });
});

describe('encodeTerrarium', () => {
  it('按 terrarium 编码，读回来误差不到 1/256 米，不透明', () => {
    const heights = new Float32Array([-12.3, 0, 35.75, 8848.9]);

    const rgba = encodeTerrarium(heights);

    for (let i = 0; i < heights.length; i++) {
      const decoded = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768;
      expect(Math.abs(decoded - heights[i])).toBeLessThan(1 / 256);
      expect(rgba[i * 4 + 3]).toBe(255);
    }
  });
});
