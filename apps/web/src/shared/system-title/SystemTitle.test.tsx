import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { appConfig } from '../config/app-config';
import outline from './system-title-outline.json';
import { SystemTitle } from './SystemTitle';

describe('SystemTitle', () => {
  // CI 中没有字体文件，无法重新生成，靠这条测试发现"改了文字但没有重新生成轮廓"
  it('轮廓文字与 VITE_APP_TITLE 一致', () => {
    expect(
      outline.text,
      '标题轮廓已过期：请在本机放好字体后，在 apps/web 下运行 pnpm title:generate，见 docs/modules/system-title.md'
    ).toBe(appConfig.title);
  });

  it('渲染为带无障碍文本、颜色跟随外部的 SVG', () => {
    const wrapper = mount(SystemTitle);
    const svg = wrapper.find('svg');

    expect(svg.attributes('role')).toBe('img');
    expect(svg.attributes('aria-label')).toBe(appConfig.title);
    expect(wrapper.find('path').attributes('fill')).toBe('currentColor');
  });
});
