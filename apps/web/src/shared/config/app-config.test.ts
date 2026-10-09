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
});
