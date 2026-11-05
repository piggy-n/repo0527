import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { MxSection } from './MxSection';

describe('MxSection', () => {
  it('标题是 h3，内容放在标题之后的内容区里', () => {
    const wrapper = mount(() => (
      <MxSection title="年份选择">
        <label>监测数据年度</label>
        <label>变更本底年度</label>
      </MxSection>
    ));

    const headings = wrapper.findAll('h2, h3');
    expect(headings.map(heading => [heading.element.tagName, heading.text()])).toEqual([['H3', '年份选择']]);
    const body = wrapper.findAll('[class*="_body_"]');
    expect(body.map(element => element.findAll('label').length)).toEqual([2]);
  });

  it('icon、extra 原样交给区块标题', () => {
    const wrapper = mount(() => (
      <MxSection title="选择表">
        {{
          default: () => '表格清单',
          icon: () => <svg data-test="icon" />,
          extra: () => <button type="button">全选</button>
        }}
      </MxSection>
    ));

    expect(wrapper.find('[class*="_mark_"]').exists()).toBe(false);
    expect(wrapper.findAll('[class*="_icon_"] [data-test="icon"]')).toHaveLength(1);
    expect(wrapper.findAll('[class*="_extra_"] button').map(button => button.text())).toEqual(['全选']);
  });
});
