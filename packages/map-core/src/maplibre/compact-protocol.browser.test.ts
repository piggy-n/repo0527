import { addProtocol, Map as MapLibreMap, removeProtocol } from 'maplibre-gl';
import { describe, expect, it, onTestFinished } from 'vitest';
import { type CompactTileReader, createCompactTileReader, type TileImageType } from '../tiles/arcgis-compact';
import { compactBundle, compactFetch, compactFiles } from '../testing/compact-fixture';
import { COMPACT_TILE_PROTOCOL, compactTileTemplate, createCompactTileProtocol } from './compact-protocol';

// 真实的 MapLibre 经自定义协议读合成的紧凑缓存（ADR 0165 第 3 节）：fetch 注入，不发网络请求

const ROOT = 'http://compact.test/imagery/';
const WAIT_TIMEOUT = 10_000;
const SIZE = 512;

async function solidTile(type: TileImageType, color: string): Promise<Uint8Array<ArrayBuffer>> {
  const canvas = new OffscreenCanvas(256, 256);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('没有 2D 画布');
  }
  context.fillStyle = color;
  context.fillRect(0, 0, 256, 256);
  const blob = await canvas.convertToBlob({ type, quality: 0.95 });
  return new Uint8Array(await blob.arrayBuffer());
}

// z 级瓦片行号 y 的中线的纬度
function rowCenterLatitude(z: number, y: number): number {
  const n = Math.PI - (2 * Math.PI * (y + 0.5)) / 2 ** z;
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

function whenIdle(map: MapLibreMap): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${WAIT_TIMEOUT} 毫秒内没等到 idle`)), WAIT_TIMEOUT);
    map.once('idle', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// 画布上一点的颜色（CSS 像素）
function pixelAt(map: MapLibreMap, x: number, y: number): number[] {
  const source = map.getCanvas();
  const ratio = source.width / SIZE;
  const canvas = new OffscreenCanvas(source.width, source.height);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('没有 2D 画布');
  }
  context.drawImage(source, 0, 0);
  return Array.from(context.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data.subarray(0, 3));
}

function expectColor(actual: number[], expected: readonly number[]): void {
  const close = actual.every((value, index) => Math.abs(value - (expected[index] ?? 0)) <= 24);
  expect(close, `${actual.join(',')} 应接近 ${expected.join(',')}`).toBe(true);
}

describe('compact-protocol（真实的 MapLibre）', () => {
  it('JPEG、PNG 瓦片都能解码显示；缺的瓦片改用上一级、不发 error', async () => {
    const files = compactFiles(ROOT, {
      // z10：849/415 是 JPEG 红，850/415 是 PNG 蓝，第 414、416 行没有
      '_alllayers/L10/R0180C0300': compactBundle([
        { column: 81, row: 31, data: await solidTile('image/jpeg', '#ff0000') },
        { column: 82, row: 31, data: await solidTile('image/png', '#0000ff') }
      ]),
      // z9：424/207（849/414 的上一级）是 PNG 黄，425/207 没有；z8、z7 整块没有
      '_alllayers/L09/R0080C0180': compactBundle([
        { column: 40, row: 79, data: await solidTile('image/png', '#ffff00') }
      ])
    });
    const reader = createCompactTileReader({ fetch: compactFetch(files) });
    const missing: string[] = [];
    const recording: CompactTileReader = {
      read: async (root, z, x, y, signal) => {
        const tile = await reader.read(root, z, x, y, signal);
        if (!tile) {
          missing.push(`${z}/${x}/${y}`);
        }
        return tile;
      }
    };
    addProtocol(COMPACT_TILE_PROTOCOL, createCompactTileProtocol(recording));
    onTestFinished(() => removeProtocol(COMPACT_TILE_PROTOCOL));

    const container = document.createElement('div');
    container.style.cssText = `width: ${SIZE}px; height: ${SIZE}px`;
    document.body.append(container);
    // z9 的地图用 z10 的 256 像素瓦片：画布中心是 849、850 两列的交界、第 415 行的中线
    const map = new MapLibreMap({
      container,
      style: {
        version: 8,
        sources: {
          basemap: { type: 'raster', tiles: [compactTileTemplate(ROOT)], tileSize: 256, minzoom: 7, maxzoom: 18 }
        },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#00ff00' } },
          { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-fade-duration': 0 } }
        ]
      },
      center: [(850 / 1024) * 360 - 180, rowCenterLatitude(10, 415)],
      zoom: 9,
      fadeDuration: 0,
      interactive: false,
      attributionControl: false,
      canvasContextAttributes: { preserveDrawingBuffer: true }
    });
    onTestFinished(() => {
      map.remove();
      container.remove();
    });
    const errors: unknown[] = [];
    map.on('error', event => errors.push(event.error));
    await whenIdle(map);

    expect(errors).toEqual([]);
    expect(missing).toEqual(expect.arrayContaining(['10/849/414', '10/850/414', '9/425/207']));
    expectColor(pixelAt(map, 128, 256), [255, 0, 0]);
    expectColor(pixelAt(map, 384, 256), [0, 0, 255]);
    // 849/414 缺：上一级的黄色放大显示
    expectColor(pixelAt(map, 128, 64), [255, 255, 0]);
    // 850/414 和它的上一级都缺：只有背景
    expectColor(pixelAt(map, 384, 64), [0, 255, 0]);
  });
});
