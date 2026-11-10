// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// appConfig 在模块加载时读取环境变量，所以每个用例都要重新加载模块
async function loadAppConfig() {
  vi.resetModules();
  const { appConfig } = await import('./app-config');
  return appConfig;
}

describe('appConfig', () => {
  it('读取 .env 中的变量', async () => {
    const appConfig = await loadAppConfig();

    expect(appConfig.title).toBe('江苏省统一调查监测现状图');
    expect(appConfig.apiBaseUrl).toBe('/backend');
    expect(appConfig.loginPublicKey).toMatch(/^04[0-9a-f]{128}$/);
  });

  it('变量为空时加载即报错', async () => {
    vi.stubEnv('VITE_APP_TITLE', '');

    await expect(loadAppConfig()).rejects.toThrow('缺少环境变量 VITE_APP_TITLE');
  });

  it.each([
    ['少了一位', `04${'a'.repeat(127)}`],
    ['缺少 04 前缀', 'a'.repeat(130)],
    ['含非十六进制字符', `04${'g'.repeat(128)}`]
  ])('SM2 公钥格式不对（%s）时加载即报错', async (_, key) => {
    vi.stubEnv('VITE_LOGIN_PUBLIC_KEY', key);

    await expect(loadAppConfig()).rejects.toThrow('VITE_LOGIN_PUBLIC_KEY 不是有效的 SM2 公钥');
  });

  it('离开页面后重置跟随开关；开关只能是 true 或 false（ADR 0114）', async () => {
    vi.stubEnv('VITE_PAGE_STATE_RESET', 'false');
    expect((await loadAppConfig()).pageStateReset).toBe(false);

    vi.stubEnv('VITE_PAGE_STATE_RESET', 'true');
    expect((await loadAppConfig()).pageStateReset).toBe(true);

    vi.stubEnv('VITE_PAGE_STATE_RESET', 'yes');
    await expect(loadAppConfig()).rejects.toThrow('VITE_PAGE_STATE_RESET 只能是 true 或 false');
  });

  it('资源的最小显示级别跟随开关；开关只能是 true 或 false（ADR 0132）', async () => {
    vi.stubEnv('VITE_RESOURCE_MIN_ZOOM_ENABLED', 'true');
    expect((await loadAppConfig()).resourceMinZoomEnabled).toBe(true);

    vi.stubEnv('VITE_RESOURCE_MIN_ZOOM_ENABLED', 'false');
    expect((await loadAppConfig()).resourceMinZoomEnabled).toBe(false);

    vi.stubEnv('VITE_RESOURCE_MIN_ZOOM_ENABLED', 'off');
    await expect(loadAppConfig()).rejects.toThrow('VITE_RESOURCE_MIN_ZOOM_ENABLED 只能是 true 或 false');

    vi.stubEnv('VITE_RESOURCE_MIN_ZOOM_ENABLED', '');
    await expect(loadAppConfig()).rejects.toThrow('缺少环境变量 VITE_RESOURCE_MIN_ZOOM_ENABLED');
  });

  it('三维引擎只能是 cesium 或 maplibre，不能为空（ADR 0147）', async () => {
    vi.stubEnv('VITE_MAP_3D_ENGINE', 'maplibre');
    expect((await loadAppConfig()).map3dEngine).toBe('maplibre');

    vi.stubEnv('VITE_MAP_3D_ENGINE', 'cesium');
    expect((await loadAppConfig()).map3dEngine).toBe('cesium');

    vi.stubEnv('VITE_MAP_3D_ENGINE', 'three');
    await expect(loadAppConfig()).rejects.toThrow('VITE_MAP_3D_ENGINE 只能是 cesium 或 maplibre，当前是 "three"');

    vi.stubEnv('VITE_MAP_3D_ENGINE', '');
    await expect(loadAppConfig()).rejects.toThrow('缺少环境变量 VITE_MAP_3D_ENGINE');
  });

  describe('偏好的开关（ADR 0140）', () => {
    const ITEMS = [
      ['basemap', 'VITE_PREFERENCE_BASEMAP'],
      ['basemap-labels', 'VITE_PREFERENCE_BASEMAP_LABELS'],
      ['boundaries', 'VITE_PREFERENCE_BOUNDARIES'],
      ['resource-layers', 'VITE_PREFERENCE_RESOURCE_LAYERS'],
      ['resource-symbols', 'VITE_PREFERENCE_RESOURCE_SYMBOLS'],
      ['resource-panel', 'VITE_PREFERENCE_RESOURCE_PANEL']
    ] as const;
    const ALL_ON = Object.fromEntries(ITEMS.map(([name]) => [name, true]));
    const ALL_OFF = Object.fromEntries(ITEMS.map(([name]) => [name, false]));

    it('都打开时每一项都生效', async () => {
      expect((await loadAppConfig()).preferences).toStrictEqual(ALL_ON);
    });

    it.each(ITEMS)('%s 的分项开关关闭时只有它不生效', async (name, variable) => {
      vi.stubEnv(variable, 'false');

      expect((await loadAppConfig()).preferences).toStrictEqual({ ...ALL_ON, [name]: false });
    });

    it('总开关关闭时每一项都不生效，分项开关打开也一样', async () => {
      vi.stubEnv('VITE_PREFERENCES_ENABLED', 'false');

      expect((await loadAppConfig()).preferences).toStrictEqual(ALL_OFF);
    });

    it('总开关只能是 true 或 false，不能为空', async () => {
      vi.stubEnv('VITE_PREFERENCES_ENABLED', 'off');
      await expect(loadAppConfig()).rejects.toThrow('VITE_PREFERENCES_ENABLED 只能是 true 或 false');

      vi.stubEnv('VITE_PREFERENCES_ENABLED', '');
      await expect(loadAppConfig()).rejects.toThrow('缺少环境变量 VITE_PREFERENCES_ENABLED');
    });

    it.each(ITEMS)('%s 的分项开关写错时加载即报错，总开关关闭时也一样', async (_, variable) => {
      vi.stubEnv(variable, 'yes');
      await expect(loadAppConfig()).rejects.toThrow(`${variable} 只能是 true 或 false`);

      vi.stubEnv('VITE_PREFERENCES_ENABLED', 'false');
      await expect(loadAppConfig()).rejects.toThrow(`${variable} 只能是 true 或 false`);

      vi.stubEnv(variable, '');
      await expect(loadAppConfig()).rejects.toThrow(`缺少环境变量 ${variable}`);
    });
  });

  describe('天地图（ADR 0031）', () => {
    it('.env 中开启，带着 key', async () => {
      const appConfig = await loadAppConfig();

      expect(appConfig.tianditu).not.toBeNull();
      expect(appConfig.tianditu?.key).toMatch(/^[0-9a-f]{32}$/);
    });

    it('关闭时为 null，不要求 key', async () => {
      vi.stubEnv('VITE_TIANDITU_ENABLED', 'false');
      vi.stubEnv('VITE_TIANDITU_KEY', '');

      await expect(loadAppConfig()).resolves.toHaveProperty('tianditu', null);
    });

    it('关闭时即使有 key 也为 null', async () => {
      vi.stubEnv('VITE_TIANDITU_ENABLED', 'false');

      await expect(loadAppConfig()).resolves.toHaveProperty('tianditu', null);
    });

    it('开关为空时加载即报错', async () => {
      vi.stubEnv('VITE_TIANDITU_ENABLED', '');

      await expect(loadAppConfig()).rejects.toThrow('缺少环境变量 VITE_TIANDITU_ENABLED');
    });

    it.each(['TRUE', 'False', '1', '0', 'yes', ' true'])('开关为 "%s" 时加载即报错', async value => {
      vi.stubEnv('VITE_TIANDITU_ENABLED', value);

      await expect(loadAppConfig()).rejects.toThrow('VITE_TIANDITU_ENABLED 只能是 true 或 false');
    });

    it('开启时缺少 key，加载即报错', async () => {
      vi.stubEnv('VITE_TIANDITU_KEY', '');

      await expect(loadAppConfig()).rejects.toThrow('缺少环境变量 VITE_TIANDITU_KEY');
    });

    it.each([
      ['少了一位', 'a'.repeat(31)],
      ['多了一位', 'a'.repeat(33)],
      ['含非十六进制字符', 'g'.repeat(32)]
    ])('开启时 key 格式不对（%s），加载即报错', async (_, key) => {
      vi.stubEnv('VITE_TIANDITU_KEY', key);

      await expect(loadAppConfig()).rejects.toThrow('VITE_TIANDITU_KEY 不是有效的天地图 key');
    });
  });
});
