import 'cesium/Build/Cesium/Widgets/widgets.css';
import { buildModuleUrl } from 'cesium';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevCesiumPage } from './DevCesiumPage';

(buildModuleUrl as typeof buildModuleUrl & { setBaseUrl(url: string): void }).setBaseUrl('/cesium/');

afterEach(() => { document.body.replaceChildren(); });

describe('三维开发页实际装配', () => {
  it('通过公共上下文定位，暂停期间的定位在恢复后执行，并能重新创建画布', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    host.style.cssText = 'height:700px;width:1100px;';
    const wrapper = mount(DevCesiumPage, { props: { assetBaseUrl: '/cesium/' }, attachTo: host });
    const button = (name: string) => {
      const found = wrapper.findAll('button').find(item => item.text() === name);
      if (!found) {
        throw new Error(`缺少按钮：${name}`);
      }
      return found;
    };
    await vi.waitFor(() => expect(wrapper.get('[data-cesium-state]').attributes('data-cesium-state')).toBe('ready'), {
      timeout: 10000
    });
    await button('定位到南京').trigger('click');
    await vi.waitFor(() => expect(wrapper.get('[data-session-camera]').text()).toContain('118.80000, 32.05000'), {
      timeout: 5000
    });
    await button('暂停').trigger('click');
    const paused = wrapper.get('[data-session-camera]').text();
    await button('江苏范围').trigger('click');
    expect(wrapper.get('[data-session-camera]').text()).toBe(paused);
    await button('恢复').trigger('click');
    await vi.waitFor(() => expect(wrapper.get('[data-session-camera]').text()).toContain('俯角 0.0°'), { timeout: 5000 });
    await button('释放画布').trigger('click');
    expect(wrapper.find('canvas').exists()).toBe(false);
    await button('创建画布').trigger('click');
    await vi.waitFor(() => expect(wrapper.get('[data-cesium-state]').attributes('data-cesium-state')).toBe('ready'), {
      timeout: 10000
    });
    expect(wrapper.find('canvas').exists()).toBe(true);
    await button('模拟底图加载失败').trigger('click');
    await vi.waitFor(() => expect(wrapper.get('[data-cesium-state]').attributes('data-cesium-state')).toBe('failed'), {
      timeout: 10000
    });
    await button('重新创建 / 重试').trigger('click');
    await vi.waitFor(() => expect(wrapper.get('[data-cesium-state]').attributes('data-cesium-state')).toBe('ready'), {
      timeout: 10000
    });
    wrapper.unmount();
    expect(host.querySelector('canvas')).toBeNull();
  }, 30000);
});
