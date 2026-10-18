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

// 软件 WebGL 的 27 层首屏实测约 24 秒，功能等待留出编译余量，性能验收另属 3D.4
const READY_TIMEOUT = 45000;

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
    const waitReady = (kind: '2d' | '3d', step: string) => vi.waitFor(() => {
      const status = wrapper.get('[data-cesium-state]');
      expect(status.attributes('data-cesium-state'), `${step}：目标 ${kind}，当前 ${status.attributes('data-current-view')}`)
        .toBe('ready');
      expect(status.attributes('data-current-view')).toBe(kind);
    }, { timeout: READY_TIMEOUT });
    await waitReady('2d', '首次创建');
    const model: unknown = commits.mock.contexts[0];
    expect(model).toBeInstanceOf(StyleModel);
    if (!(model instanceof StyleModel)) {
      throw new Error('开发页没有创建样式会话');
    }
    expect(model.current.layers.map(layer => layer.id)).toEqual([
      'sample-background', 'sample-raster-below', 'sample-mvt-fill', 'sample-fill', 'sample-raster-overlay',
      'sample-mvt-pattern', 'sample-pattern', 'sample-outline',
      'sample-mvt-line', 'sample-line', 'sample-mvt-points', 'sample-points',
      'selection-batch-fill', 'selection-batch-line', 'selection-batch-circle',
      'selection-fill', 'selection-line', 'selection-circle', 'region-clip-mask', 'region-glow', 'region-line',
      'measure-fill-completed', 'measure-fill-drawing', 'measure-line-completed', 'measure-line-drawing', 'measure-vertex'
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
    await waitReady('3d', '首次三维失败后重试');
    const three = wrapper.get('[data-map-view="3d"] canvas').element;
    expect(three.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(wrapper.get('[data-map-view="2d"]').attributes('inert')).toBeDefined();
    await button('定位到南京').trigger('click');
    await vi.waitFor(() => expect(wrapper.get('[data-session-camera]').text()).toContain('118.80000, 32.05000'), {
      timeout: 5000
    });
    const camera = wrapper.get('[data-session-camera]').text();
    await button('二维').trigger('click');
    await waitReady('2d', '返回缓存二维');
    expect(wrapper.get('[data-map-view="2d"] canvas').element).toBe(two);
    await button('样例变色').trigger('click');
    await button('栅格移到面下').trigger('click');
    expect(wrapper.get('[data-map-view="3d"]').attributes('inert')).toBeDefined();
    expect(model.current.layers.find(layer => layer.id === 'sample-fill')).toMatchObject({ paint: {
      'fill-color': ['match', ['get', 'category'], 'primary', '#13c2c2', '#eb2f96']
    } });
    const changedStyle = model.current;
    expect(model.images['sample-pattern-medium']).toMatchObject({ sdf: true, width: 32, pixelRatio: 2 });
    expect(changedStyle.layers.find(layer => layer.id === 'selection-line')).toMatchObject({ paint: {
      'line-color': '#ff7875'
    } });
    const revision = model.revision;
    await button('三维').trigger('click');
    await waitReady('3d', '恢复缓存三维');
    expect(wrapper.get('[data-map-view="3d"] canvas').element).toBe(three);
    expect(wrapper.get('[data-session-camera]').text()).toBe(camera);
    expect(model.current).toBe(changedStyle);
    expect(model.revision).toBe(revision);
    expect(prepareRuntime.mock.calls).toEqual([['2d'], ['3d']]);
    await button('隐藏样例').trigger('click');
    expect(model.current.sources).toEqual({});
    expect(model.current.layers.map(layer => layer.id)).toEqual(['sample-background']);
    await button('显示样例').trigger('click');
    expect(model.current.layers.find(layer => layer.id === 'sample-mvt-fill')).toMatchObject({ paint: {
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
    await waitReady('2d', '释放后重建');
    expect(wrapper.find('canvas').exists()).toBe(true);
    wrapper.unmount();
    expect(host.querySelector('canvas')).toBeNull();
  }, 60000);
});
