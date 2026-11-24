import { addProtocol, Map as MapLibreMap, removeProtocol } from 'maplibre-gl';
import { describe, expect, it, onTestFinished } from 'vitest';
import { type FetchTerrainTile, TiandituTerrainReader } from '../tiles/tianditu-terrain';
import { createTiandituTerrain, TERRAIN_SOURCE_ID, TIANDITU_TERRAIN_PROTOCOL } from './terrain';

// 真实的 MapLibre 经自定义协议读合成的天地图地形（ADR 0170）：瓦片由注入的函数生成，不请求天地图

const WAIT_TIMEOUT = 10_000;
const SAMPLES = 150;
const AT: readonly [number, number] = [117.18, 34.266];

// 线性的地形：插值没有误差，只差存成整数的 0.5 米
const terrainAt = (lng: number, lat: number) => 100 + (lng - 117) * 1000 + (lat - 34) * 500;

const fetchTile: FetchTerrainTile = async url => {
  const params = new URL(url).searchParams;
  const [x, y, level] = ['x', 'y', 'l'].map(name => Number(params.get(name)));
  const size = 360 / 2 ** level;
  const bytes = new Uint8Array(SAMPLES * SAMPLES * 2);
  const view = new DataView(bytes.buffer);
  for (let row = 0; row < SAMPLES; row++) {
    for (let column = 0; column < SAMPLES; column++) {
      const lng = -180 + (x + column / (SAMPLES - 1)) * size;
      const lat = 90 - (y + row / (SAMPLES - 1)) * size;
      view.setInt16((row * SAMPLES + column) * 2, Math.round(terrainAt(lng, lat)), true);
    }
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Response(stream).arrayBuffer();
};

function whenIdle(map: MapLibreMap): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${WAIT_TIMEOUT} 毫秒内没等到 idle`)), WAIT_TIMEOUT);
    map.once('idle', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe('天地图地形的协议（真实的 MapLibre）', () => {
  it('MapLibre 读回的地形高度和贴地取的高度都等于数据的高度', async () => {
    const { protocol, terrain } = createTiandituTerrain(new TiandituTerrainReader({ key: 'test', fetchTile }));
    addProtocol(TIANDITU_TERRAIN_PROTOCOL, protocol);
    onTestFinished(() => removeProtocol(TIANDITU_TERRAIN_PROTOCOL));
    const container = document.createElement('div');
    container.style.cssText = 'width: 512px; height: 512px';
    document.body.append(container);
    const map = new MapLibreMap({
      container,
      style: {
        version: 8,
        sources: { [TERRAIN_SOURCE_ID]: terrain.source },
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }],
        terrain: { source: TERRAIN_SOURCE_ID, exaggeration: 1 }
      },
      center: [...AT],
      zoom: 13,
      fadeDuration: 0,
      interactive: false,
      attributionControl: false
    });
    onTestFinished(() => {
      map.remove();
      container.remove();
    });
    const errors: unknown[] = [];
    map.on('error', event => errors.push(event.error));
    await whenIdle(map);

    expect(errors).toEqual([]);
    const expected = terrainAt(...AT);
    const rendered = map.queryTerrainElevation([...AT]);
    expect(rendered).not.toBeNull();
    expect(Math.abs((rendered ?? 0) - expected)).toBeLessThan(1.5);
    const sampled = await terrain.heightAt(AT, new AbortController().signal);
    expect(Math.abs(sampled - expected)).toBeLessThan(0.6);
  });
});
