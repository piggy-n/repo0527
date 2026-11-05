import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { MxTitle } from './MxTitle';

describe('MxTitle', () => {
  it('默认是区块标题：h3，左侧是竖杠', () => {
    const wrapper = mount(() => <MxTitle>年份选择</MxTitle>);

    const heading = wrapper.find('h2, h3');
    expect(heading.element.tagName).toBe('H3');
    expect(heading.text()).toBe('年份选择');
    expect(wrapper.find('[class*="_mark_"]').exists()).toBe(true);
  });

  it('面板标题渲染为 h2', () => {
    const wrapper = mount(() => <MxTitle level="panel">文件目录</MxTitle>);

    const heading = wrapper.find('h2, h3');
    expect(heading.element.tagName).toBe('H2');
    expect(heading.text()).toBe('文件目录');
  });

  it('传入图标时替换竖杠，图标对读屏软件隐藏', () => {
    const wrapper = mount(() => (
      <MxTitle>{{ default: () => '处理进度', icon: () => <svg data-test="icon" /> }}</MxTitle>
    ));

    expect(wrapper.find('[class*="_mark_"]').exists()).toBe(false);
    const icon = wrapper.find('[class*="_icon_"]');
    expect(icon.find('[data-test="icon"]').exists()).toBe(true);
    expect(icon.attributes('aria-hidden')).toBe('true');
  });

  it('description 紧跟在标题元素之后、不在标题元素里，悬停可看完整文字', () => {
    const wrapper = mount(() => (
      <MxTitle level="panel" description="技术标准规范 / 地方补充技术规定/细则">
        监测类
      </MxTitle>
    ));

    const heading = wrapper.find('h2, h3');
    expect(heading.text()).toBe('监测类');
    const description = heading.element.nextElementSibling;
    expect(description?.textContent).toBe('技术标准规范 / 地方补充技术规定/细则');
    expect(description?.getAttribute('title')).toBe('技术标准规范 / 地方补充技术规定/细则');
  });

  it('extra 放在标题元素之外', () => {
    const wrapper = mount(() => (
      <MxTitle>{{ default: () => '选择表', extra: () => <button type="button">全选</button> }}</MxTitle>
    ));

    expect(wrapper.find('h2, h3').text()).toBe('选择表');
    expect(wrapper.find('h2 button, h3 button').exists()).toBe(false);
    expect(wrapper.find('[class*="_extra_"] button').text()).toBe('全选');
  });
});
