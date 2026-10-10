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
