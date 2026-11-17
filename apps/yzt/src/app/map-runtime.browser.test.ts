import { compactTileTemplate } from '@mx/map-core';
import { getWorkerCount, Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { workerCountFor } from './map-runtime';

const WAIT_TIMEOUT = 10_000;

// test-setup.browser.ts 已经调用过 setupMapRuntime；核数不超过 3 时公式和 MapLibre 的默认值都是 1，这条用例区分不了
describe('setupMapRuntime', () => {
  it('按核数设置了 MapLibre 的 Worker 数量', () => {
    expect(getWorkerCount()).toBe(workerCountFor(navigator.hardwareConcurrency));
  });

  it('注册了紧凑缓存的协议：瓦片经读取器读 bundle 的索引，整块没有时不报错（ADR 0165 第 3 节）', async () => {
    // 别的用例没用过的根目录：读取器的索引缓存整个页面共用
    const root = `${location.origin}/__compact-protocol-test__/`;
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        requested.push(input instanceof Request ? input.url : String(input));
        return Promise.resolve(new Response('not found', { status: 404 }));
      })
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    const container = document.createElement('div');
    container.style.cssText = 'width: 256px; height: 256px';
    document.body.append(container);
    const map = new MapLibreMap({
      container,
      style: {
        version: 8,
        sources: { basemap: { type: 'raster', tiles: [compactTileTemplate(root)], tileSize: 256, minzoom: 7 } },
        layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }]
      },
      center: [118.78, 32.04],
      zoom: 7,
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

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${WAIT_TIMEOUT} 毫秒内没等到 idle`)), WAIT_TIMEOUT);
      map.once('idle', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    expect(errors).toStrictEqual([]);
    // 没注册时 MapLibre 会直接 fetch arcgis-compact:// 的地址
    expect(requested.length).toBeGreaterThan(0);
    const bundleIndex = /^_alllayers\/L\d{2}\/R[\da-f]{4,}C[\da-f]{4,}\.bundlx$/;
    const others = requested.filter(url => !(url.startsWith(root) && bundleIndex.test(url.slice(root.length))));
    expect(others).toStrictEqual([]);
  });
});
