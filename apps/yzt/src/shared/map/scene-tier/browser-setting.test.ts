// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createDeviceStore } from '../../storage/device-store';
import { MemoryStorage } from '../../storage/testing';
import { applySceneTierQuery, readBrowserSetting, sceneTierQueryValue } from './browser-setting';

function setup() {
  const storage = new MemoryStorage();
  return { storage, store: createDeviceStore(storage) };
}

describe('applySceneTierQuery', () => {
  it.each(['auto', 'low', 'standard', 'high', 'workstation'] as const)('%s：记成本浏览器的设定，地址栏显示它', value => {
    const { storage, store } = setup();
    const setting = applySceneTierQuery(`?year=2024&scene-tier=${value}`, store);
    expect(setting).toBe(value);
    expect(readBrowserSetting(store)).toBe(value);
    expect(storage.getItem('yzt.device.scene-tier:setting')).toBe(JSON.stringify(value));
    expect(sceneTierQueryValue(setting)).toBe(value);
  });

  it('可以改成别的档位，往上往下都行', () => {
    const { store } = setup();
    applySceneTierQuery('?scene-tier=low', store);
    applySceneTierQuery('?scene-tier=workstation', store);
    expect(readBrowserSetting(store)).toBe('workstation');
    applySceneTierQuery('?scene-tier=standard', store);
    expect(readBrowserSetting(store)).toBe('standard');
  });

  it('default 清掉设定，地址栏显示 default；清掉了已有的设定时在控制台写一行', () => {
    const { storage, store } = setup();
    applySceneTierQuery('?scene-tier=high', store);
    using info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const setting = applySceneTierQuery('?scene-tier=default', store);
    expect(setting).toBeUndefined();
    expect(readBrowserSetting(store)).toBeUndefined();
    expect(storage.length).toBe(0);
    expect(sceneTierQueryValue(setting)).toBe('default');
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0]?.[0]).toBe('[scene-tier] 地址栏的 scene-tier=default 清掉了本浏览器的设定（原来是 high），回到部署文件');
  });

  it('本来就没有设定时 default 什么也不写', () => {
    const { store } = setup();
    using info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    expect(applySceneTierQuery('?scene-tier=default', store)).toBeUndefined();
    expect(info).not.toHaveBeenCalled();
  });

  it('没有这个参数：不改，这个页面用存着的设定', () => {
    const { store } = setup();
    applySceneTierQuery('?scene-tier=high', store);
    expect(applySceneTierQuery('', store)).toBe('high');
    expect(applySceneTierQuery('?year=2024', store)).toBe('high');
    expect(readBrowserSetting(store)).toBe('high');
  });

  it.each(['ultra', 'HIGH', ''])('不认得的值（%s）：警告一次，设定不变', value => {
    const { store } = setup();
    applySceneTierQuery('?scene-tier=high', store);
    using warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(applySceneTierQuery(`?scene-tier=${value}`, store)).toBe('high');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain(`scene-tier=${value} 不认得`);
    expect(readBrowserSetting(store)).toBe('high');
  });

  it('存进去的值不合法（被手改过）：当没有设定', () => {
    const { storage, store } = setup();
    storage.setItem('yzt.device.scene-tier:setting', '"ultra"');
    expect(readBrowserSetting(store)).toBeUndefined();
    expect(sceneTierQueryValue(applySceneTierQuery('', store))).toBe('default');
  });
});
