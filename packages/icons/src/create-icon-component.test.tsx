import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createIconComponent } from './create-icon-component';

const icons = {
  user: { viewBox: '0 0 24 24', body: '<path d="M0 0h24v24H0z"/>' },
  arrow: {
    viewBox: '0 0 16 16',
    attrs: { fill: 'none', stroke: 'currentColor', 'stroke-width': '2' },
    body: '<path d="M2 8h12"/>'
  }
} as const;

const TestIcon = createIconComponent(icons, 'TestIcon');

describe('createIconComponent', () => {
  it('按名字渲染 viewBox 和内部标记，默认用 currentColor 填充', () => {
    const svg = mount(() => <TestIcon name="user" />).find('svg');

    expect(svg.attributes('viewBox')).toBe('0 0 24 24');
    expect(svg.attributes('fill')).toBe('currentColor');
    expect(svg.find('path').attributes('d')).toBe('M0 0h24v24H0z');
  });

  it('根元素属性来自注册表，可以覆盖默认的 fill', () => {
    const svg = mount(() => <TestIcon name="arrow" />).find('svg');

    expect(svg.attributes('fill')).toBe('none');
    expect(svg.attributes('stroke')).toBe('currentColor');
    expect(svg.attributes('stroke-width')).toBe('2');
  });

  it('size 为数字时按 px，color 和 rotate 写入行内样式', () => {
    const svg = mount(() => <TestIcon name="user" size={20} color="red" rotate={90} />).find('svg');
    const { style } = svg.element as SVGSVGElement;

    expect(style.width).toBe('20px');
    expect(style.height).toBe('20px');
    expect(style.color).toBe('red');
    expect(style.transform).toBe('rotate(90deg)');
  });

  it('size 为字符串时原样使用', () => {
    const svg = mount(() => <TestIcon name="user" size="2em" />).find('svg');

    expect((svg.element as SVGSVGElement).style.width).toBe('2em');
  });

  it('有 title 时作为图片供读屏软件读出，没有时对读屏软件隐藏', () => {
    const titled = mount(() => <TestIcon name="user" title="用户" />).find('svg');
    const decorative = mount(() => <TestIcon name="user" />).find('svg');

    expect(titled.attributes('role')).toBe('img');
    expect(titled.attributes('aria-label')).toBe('用户');
    expect(titled.attributes('aria-hidden')).toBeUndefined();
    expect(decorative.attributes('aria-hidden')).toBe('true');
    expect(decorative.attributes('role')).toBeUndefined();
  });

  it('名字不存在时不渲染并给出警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // @ts-expect-error 名字不在注册表中，类型检查应该报错
    const wrapper = mount(() => <TestIcon name="missing" />);

    expect(wrapper.find('svg').exists()).toBe(false);
    expect(warn).toHaveBeenCalledWith('[TestIcon] 找不到图标：missing');
    warn.mockRestore();
  });
});
