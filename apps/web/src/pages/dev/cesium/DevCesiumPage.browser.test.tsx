import 'cesium/Build/Cesium/Widgets/widgets.css';
// oxlint-disable-next-line no-restricted-imports -- 页面浏览器测试独立准备真实引擎运行时，不依赖 app
import 'maplibre-gl/dist/maplibre-gl.css';
// oxlint-disable-next-line no-restricted-imports -- 页面浏览器测试使用本地 Worker，与应用运行时一致
import { setWorkerUrl } from 'maplibre-gl';
// oxlint-disable-next-line no-restricted-imports -- 页面浏览器测试的本地 Worker 地址
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { buildModuleUrl } from 'cesium';
import { mount } from '@vue/test-utils';
import { StyleModel } from '@yzt/map-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevCesiumPage } from './DevCesiumPage';

(buildModuleUrl as typeof buildModuleUrl & { setBaseUrl(url: string): void }).setBaseUrl('/cesium/');
setWorkerUrl(workerUrl);

// 首次真实引擎着色器编译在全项目回归时较慢，按状态满足结束等待
const READY_TIMEOUT = 15000;

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('二三维开发页实际装配', () => {
  it('共享样式随显隐、换色和排序更新，切换与失败恢复保留同一会话', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    host.style.cssText = 'height:700px;width:1100px;';
    const prepareRuntime = vi.fn<() => Promise<void>>().mockResolvedValue();
    // 观察真实会话提交，不替换视图、样式模型或渲染实现
    const commits = vi.spyOn(StyleModel.prototype, 'setGroups');
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
    }, { timeout: READY_TIMEOUT });
    await waitReady('2d');
    const model: unknown = commits.mock.contexts[0];
    expect(model).toBeInstanceOf(StyleModel);
    if (!(model instanceof StyleModel)) {
      throw new Error('开发页没有创建样式会话');
    }
    expect(model.current.layers.map(layer => layer.id)).toEqual([
      'sample-background', 'sample-raster-below', 'sample-fill', 'sample-raster-overlay', 'sample-line', 'sample-points'
    ]);
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
    await button('样例变色').trigger('click');
    await button('栅格移到面下').trigger('click');
    expect(wrapper.get('[data-map-view="3d"]').attributes('inert')).toBeDefined();
    expect(model.current.layers[3]).toMatchObject({ id: 'sample-fill', paint: {
      'fill-color': ['match', ['get', 'category'], 'primary', '#13c2c2', '#eb2f96']
    } });
    const changedStyle = model.current;
    const revision = model.revision;
    await button('三维').trigger('click');
    await waitReady('3d');
    expect(wrapper.get('[data-map-view="3d"] canvas').element).toBe(three);
    expect(wrapper.get('[data-session-camera]').text()).toBe(camera);
    expect(model.current).toBe(changedStyle);
    expect(model.revision).toBe(revision);
    expect(prepareRuntime.mock.calls).toEqual([['2d'], ['3d']]);
    await button('隐藏样例').trigger('click');
    expect(model.current.sources).toEqual({});
    expect(model.current.layers.map(layer => layer.id)).toEqual(['sample-background']);
    await button('显示样例').trigger('click');
    expect(model.current.layers[3]).toMatchObject({ id: 'sample-fill', paint: {
      'fill-color': ['match', ['get', 'category'], 'primary', '#13c2c2', '#eb2f96']
    } });
    expect(new Set(commits.mock.contexts).size).toBe(1);
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
  }, 45000);
});
