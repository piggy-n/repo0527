import { buildModuleUrl } from 'cesium';
import { describe, expect, it } from 'vitest';
import { setupSceneRuntime } from './map-runtime-3d';

describe('setupSceneRuntime', () => {
  it('Worker 和资源从复制到产物的 cesium/ 加载，重复调用不改设置', () => {
    setupSceneRuntime();
    setupSceneRuntime();

    const url = new URL(buildModuleUrl('Workers/createVerticesFromHeightmap.js'));
    expect(url.pathname).toBe(`${import.meta.env.BASE_URL}cesium/Workers/createVerticesFromHeightmap.js`);
    expect(url.origin).toBe(window.location.origin);
  });
});
