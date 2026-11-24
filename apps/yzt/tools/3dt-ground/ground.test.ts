// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { coarseContent, type Fetcher } from './coarse.ts';
import { contentPoints, estimateGround, fromEcef, glbPoints, IDENTITY, type Matrix } from './ground.ts';

// WGS84：经纬度、椭球高换成地心坐标
function toEcef(lng: number, lat: number, height: number): [number, number, number] {
  const a = 6378137;
  const e2 = (1 / 298.257223563) * (2 - 1 / 298.257223563);
  const [l, p] = [(lng * Math.PI) / 180, (lat * Math.PI) / 180];
  const n = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  const r = (n + height) * Math.cos(p);
  return [r * Math.cos(l), r * Math.sin(l), (n * (1 - e2) + height) * Math.sin(p)];
}

// 东北天的局部系到地心坐标（列主序）
function enuToEcef(lng: number, lat: number): Matrix {
  const [l, p] = [(lng * Math.PI) / 180, (lat * Math.PI) / 180];
  const east = [-Math.sin(l), Math.cos(l), 0];
  const north = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)];
  const up = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
  return [...east, 0, ...north, 0, ...up, 0, ...toEcef(lng, lat, 0), 1];
}

// glb 的块按 4 字节对齐：JSON 补空格，二进制补 0
function pad(bytes: Uint8Array, fill: number): Uint8Array {
  const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(fill);
  out.set(bytes);
  return out;
}

// 一个 glb：一个网格、一个节点，顶点按给的坐标（glTF 2.0、浮点）；extra 合并进 glTF 的 JSON
function glb(
  positions: readonly (readonly [number, number, number])[],
  node: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
): Uint8Array {
  const bin = new Float32Array(positions.flat());
  const json = {
    ...extra,
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, ...node }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: positions.length, type: 'VEC3' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength }],
    buffers: [{ byteLength: bin.byteLength }]
  };
  const jsonBytes = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const binBytes = pad(new Uint8Array(bin.buffer), 0);
  const out = new Uint8Array(12 + 8 + jsonBytes.length + 8 + binBytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  view.setUint32(20 + jsonBytes.length, binBytes.length, true);
  view.setUint32(24 + jsonBytes.length, 0x004e4942, true);
  out.set(binBytes, 28 + jsonBytes.length);
  return out;
}

// b3dm 外壳：特性表只有 RTC_CENTER
function b3dm(body: Uint8Array, rtc?: readonly [number, number, number]): Uint8Array {
  const header = JSON.stringify({ BATCH_LENGTH: 0, RTC_CENTER: rtc }).padEnd(48, ' ');
  const feature = rtc ? new TextEncoder().encode(header) : new Uint8Array();
  const out = new Uint8Array(28 + feature.length + body.length);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode('b3dm'), 0);
  view.setUint32(4, 1, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, feature.length, true);
  out.set(feature, 28);
  out.set(body, 28 + feature.length);
  return out;
}

const AT = [117.18, 34.266] as const;
const heightsOf = (points: readonly [number, number, number][]) => points.map(point => fromEcef(point)[2]);

describe('读顶点', () => {
  it('glTF 默认 y 向上：先换成 z 向上，再按瓦片的变换放到地心坐标', () => {
    // y 是高度：(0, 12, 0) 在原点上方 12 米
    const { points, skipped } = glbPoints(glb([[0, 12, 0]]), enuToEcef(...AT), false);

    expect(skipped).toStrictEqual([]);
    expect(heightsOf(points)[0]).toBeCloseTo(12, 3);
  });

  it('瓦片集写了 gltfUpAxis: Z 时不转；b3dm 的 RTC_CENTER（瓦片自己的坐标系里）和节点的平移都算上', () => {
    // 瓦片的变换是东北天：RTC 往上 3 米，节点再往上 2 米，顶点再往上 5 米
    const data = b3dm(glb([[0, 0, 5]], { translation: [0, 0, 2] }), [0, 0, 3]);

    const { points } = contentPoints(data, enuToEcef(...AT), true);

    expect(heightsOf(points)[0]).toBeCloseTo(10, 3);
    const [lng, lat] = fromEcef(points[0] ?? [0, 0, 0]);
    expect(lng).toBeCloseTo(AT[0], 6);
    expect(lat).toBeCloseTo(AT[1], 6);
  });

  it('压缩的网格、别的格式不读，说出原因', () => {
    const draco = glb([[0, 0, 0]], {}, { extensionsUsed: ['KHR_draco_mesh_compression'] });

    expect(glbPoints(draco, IDENTITY, false).skipped[0]).toContain('压缩的网格');
    expect(contentPoints(new TextEncoder().encode('pnts....'), IDENTITY, false).skipped).toStrictEqual(['不读 pnts 格式']);
  });
});

describe('estimateGround', () => {
  it('低的一半里最多的那一档是地面：屋顶分散在各个高度、比地面多的高处也不算', () => {
    const frame = enuToEcef(...AT);
    const m = (i: number) => frame[i] ?? 0;
    const at = (east: number, north: number, up: number): [number, number, number] =>
      [0, 1, 2].map(i => m(i) * east + m(4 + i) * north + m(8 + i) * up + m(12 + i)) as [number, number, number];
    // 地面在 33 米上下，40 个点；一个坑 5 个点在 26 米；屋顶 60 个点在 40～99 米
    const ground = Array.from({ length: 40 }, (_, i) => at(i - 20, 10, 33.2 + (i % 3) * 0.2));
    const pit = Array.from({ length: 5 }, (_, i) => at(i, -50, 26));
    const roofs = Array.from({ length: 60 }, (_, i) => at(i, 30, 40 + i));

    const estimate = estimateGround([...ground, ...pit, ...roofs]);

    expect(estimate.height).toBeCloseTo(33.4, 1);
    expect(estimate.vertices).toBe(105);
    expect(estimate.spread[0]).toBeCloseTo(26, 3);
    // 参照点在地面那一档的中间
    const [lng, lat] = fromEcef(at(-0.5, 10, 0));
    expect(estimate.lng).toBeCloseTo(lng, 6);
    expect(estimate.lat).toBeCloseTo(lat, 6);
  });

  it('没有顶点时报错', () => {
    expect(() => estimateGround([])).toThrow('没有读到顶点');
  });
});

describe('coarseContent', () => {
  it('按层找第一层有模型内容的瓦片，外部索引照着走进去，只读最粗的那一层', async () => {
    const frame = enuToEcef(...AT);
    const files: Record<string, unknown> = {
      'https://models.test/a/tileset.json': {
        asset: { version: '1.0' },
        root: { transform: frame, children: [{ content: { uri: 'block/tileset.json' } }] }
      },
      'https://models.test/a/block/tileset.json': {
        asset: { version: '1.0', gltfUpAxis: 'Z' },
        root: { content: { uri: 'coarse.glb' }, children: [{ content: { uri: 'fine.glb' } }] }
      }
    };
    const contents: Record<string, Uint8Array> = {
      'https://models.test/a/block/coarse.glb': glb([[0, 0, 33]]),
      'https://models.test/a/block/fine.glb': glb([[0, 0, 99]])
    };
    const requested: string[] = [];
    const fetcher: Fetcher = {
      json: async url => files[url],
      bytes: async url => {
        requested.push(url);
        return contents[url] ?? null;
      }
    };

    const coarse = await coarseContent('https://models.test/a/tileset.json', fetcher, 16);

    expect(requested).toStrictEqual(['https://models.test/a/block/coarse.glb']);
    expect(coarse.contents).toBe(1);
    expect(heightsOf(coarse.points)[0]).toBeCloseTo(33, 3);
  });
});
