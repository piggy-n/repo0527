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
  });

  it('变量为空时加载即报错', async () => {
    vi.stubEnv('VITE_APP_TITLE', '');

    await expect(loadAppConfig()).rejects.toThrow('缺少环境变量 VITE_APP_TITLE');
  });
});
