import { describe, expect, it, vi } from 'vitest';

// appConfig 和这一页的地形都在模块里只建一次：每个用例重新加载
async function loadPageTerrain() {
  vi.resetModules();
  const { pageTerrain } = await import('./map-terrain');
  return pageTerrain;
}

describe('pageTerrain（ADR 0170）', () => {
  it('部署没有配地形时为 null，不请求天地图', async () => {
    vi.stubEnv('VITE_SCENE_TERRAIN', 'none');
    const pageTerrain = await loadPageTerrain();

    expect(pageTerrain()).toBeNull();
  });

  it('配了天地图的地形时给出 raster-dem 数据源（经自定义协议），一个页面只建一个', async () => {
    vi.stubEnv('VITE_TIANDITU_ENABLED', 'true');
    vi.stubEnv('VITE_TIANDITU_KEY', 'a'.repeat(32));
    vi.stubEnv('VITE_SCENE_TERRAIN', 'tianditu');
    const pageTerrain = await loadPageTerrain();

    const terrain = pageTerrain();
    expect(terrain?.source).toMatchObject({
      type: 'raster-dem',
      tiles: ['tianditu-terrain://{z}/{x}/{y}'],
      encoding: 'terrarium'
    });
    expect(pageTerrain()).toBe(terrain);
  });
});
