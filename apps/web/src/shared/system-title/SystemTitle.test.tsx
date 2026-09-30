import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { appConfig } from '../config/app-config';
import { SystemTitle } from './SystemTitle';
import { WelcomeText } from './WelcomeText';

// 轮廓是否与配置一致，由 tools/system-title/outlines.test.ts 检查
describe('SystemTitle', () => {
  it('渲染为带无障碍文本、颜色跟随外部的 SVG', () => {
    const wrapper = mount(SystemTitle);
    const svg = wrapper.find('svg');

    expect(svg.attributes('role')).toBe('img');
    expect(svg.attributes('aria-label')).toBe(appConfig.title);
    expect(wrapper.find('path').attributes('fill')).toBe('currentColor');
  });
});

describe('WelcomeText', () => {
  it('是装饰文字，对读屏软件隐藏，颜色跟随外部', () => {
    const wrapper = mount(WelcomeText);

    expect(wrapper.find('svg').attributes('aria-hidden')).toBe('true');
    expect(wrapper.find('path').attributes('fill')).toBe('currentColor');
  });
});
