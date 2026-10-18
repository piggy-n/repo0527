import 'cesium/Build/Cesium/Widgets/widgets.css';
// oxlint-disable-next-line no-restricted-imports -- 页面浏览器测试独立准备真实引擎运行时，不依赖 app
import 'maplibre-gl/dist/maplibre-gl.css';
// oxlint-disable-next-line no-restricted-imports -- 页面浏览器测试使用本地 Worker，与应用运行时一致
import { setWorkerUrl } from 'maplibre-gl';
// oxlint-disable-next-line no-restricted-imports -- 页面浏览器测试的本地 Worker 地址
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { buildModuleUrl } from 'cesium';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevCesiumPage } from './DevCesiumPage';

(buildModuleUrl as typeof buildModuleUrl & { setBaseUrl(url: string): void }).setBaseUrl('/cesium/');
setWorkerUrl(workerUrl);

afterEach(() => { document.body.replaceChildren(); });

describe('二三维开发页实际装配', () => {
  it('默认二维，三维加载失败保留原图，重试后交接并缓存两个视图', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    host.style.cssText = 'height:700px;width:1100px;';
    const prepareRuntime = vi.fn<() => Promise<void>>().mockResolvedValue();
    const wrapper = mount(DevCesiumPage, { props: { assetBaseUrl: '/cesium/', prepareRuntime }, attachTo: host });
    const button = (name: string) => {
      const found = wrapper.findAll('button').find(item => item.text() === name);
      if (!found) {
        throw new Error(`缺少按钮：${name}`);
      }
      return found;
    };
    const waitReady = (kind: '2d' | '3d') => vi.waitFor(() => {
      const status = wrapper.get('[data-cesium-state]');
      expect(status.attributes('data-cesium-state')).toBe('ready');
      expect(status.attributes('data-current-view')).toBe(kind);
    }, { timeout: 10000 });
    await waitReady('2d');
    const two = wrapper.get('[data-map-view="2d"] canvas').element;
    expect(wrapper.find('[data-map-view="3d"] canvas').exists()).toBe(false);
    expect(prepareRuntime).toHaveBeenCalledExactlyOnceWith('2d');
    await button('模拟首次三维加载失败').trigger('click');
    await vi.waitFor(() => expect(wrapper.get('[data-cesium-state]').attributes('data-cesium-state')).toBe('failed'));
    expect(wrapper.get('[data-cesium-state]').attributes('data-current-view')).toBe('2d');
    expect(wrapper.get('[data-map-view="2d"] canvas').element).toBe(two);
    expect(wrapper.get('[data-map-view="2d"]').attributes('inert')).toBeUndefined();
    await button('重试').trigger('click');
    await waitReady('3d');
    const three = wrapper.get('[data-map-view="3d"] canvas').element;
    expect(three.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(wrapper.get('[data-map-view="2d"]').attributes('inert')).toBeDefined();
    await button('定位到南京').trigger('click');
    await vi.waitFor(() => expect(wrapper.get('[data-session-camera]').text()).toContain('118.80000, 32.05000'), {
      timeout: 5000
    });
    const camera = wrapper.get('[data-session-camera]').text();
    await button('二维').trigger('click');
    await waitReady('2d');
    expect(wrapper.get('[data-map-view="2d"] canvas').element).toBe(two);
    await button('三维').trigger('click');
    await waitReady('3d');
    expect(wrapper.get('[data-map-view="3d"] canvas').element).toBe(three);
    expect(wrapper.get('[data-session-camera]').text()).toBe(camera);
    expect(prepareRuntime.mock.calls).toEqual([['2d'], ['3d']]);
    await button('暂停').trigger('click');
    const paused = wrapper.get('[data-session-camera]').text();
    await button('江苏范围').trigger('click');
    expect(wrapper.get('[data-session-camera]').text()).toBe(paused);
    await button('恢复').trigger('click');
    await vi.waitFor(() => expect(wrapper.get('[data-session-camera]').text()).toContain('俯角 0.0°'), { timeout: 10000 });
    await button('释放画布').trigger('click');
    expect(wrapper.find('canvas').exists()).toBe(false);
    await button('创建画布').trigger('click');
    await waitReady('2d');
    expect(wrapper.find('canvas').exists()).toBe(true);
    wrapper.unmount();
    expect(host.querySelector('canvas')).toBeNull();
  }, 30000);
});
