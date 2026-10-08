import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { MxPanel } from './MxPanel';

const icon = () => <svg data-test="icon" />;

describe('MxPanel', () => {
  it('有标题时渲染头部，标题是 h2', () => {
    const wrapper = mount(() => <MxPanel title="文件目录">内容</MxPanel>);

    const headings = wrapper.findAll('header h2, header h3');
    expect(headings.map(heading => [heading.element.tagName, heading.text()])).toEqual([['H2', '文件目录']]);
    expect(wrapper.find('[class*="_body_"]').text()).toBe('内容');
  });

  it('description 交给标题显示', () => {
    const wrapper = mount(() => <MxPanel title="监测类" description="技术标准规范">内容</MxPanel>);

    expect(wrapper.find('header [class*="_description_"]').text()).toBe('技术标准规范');
  });

  it('没有标题和操作时不渲染头部', () => {
    const wrapper = mount(() => <MxPanel>菜单</MxPanel>);

    expect(wrapper.find('header').exists()).toBe(false);
  });

  it('操作放在头部，底部只在传入时渲染', () => {
    const withFooter = mount(() => (
      <MxPanel title="资源审核">
        {{
          default: () => '表格',
          actions: () => <button type="button">上传文件</button>,
          footer: () => <nav>分页</nav>
        }}
      </MxPanel>
    ));
    const withoutFooter = mount(() => <MxPanel title="资源审核">表格</MxPanel>);

    expect(withFooter.findAll('header [class*="_actions_"] button').map(button => button.text())).toEqual([
      '上传文件'
    ]);
    expect(withFooter.findAll('footer').map(footer => footer.text())).toEqual(['分页']);
    expect(withoutFooter.find('footer').exists()).toBe(false);
  });

  it('flush 去掉内容区的内边距', () => {
    const flush = mount(() => <MxPanel flush>表格</MxPanel>);
    const normal = mount(() => <MxPanel>表格</MxPanel>);

    expect(flush.find('[class*="_body_"]').classes().join(' ')).toContain('_flush_');
    expect(normal.find('[class*="_body_"]').classes().join(' ')).not.toContain('_flush_');
  });

  it('iconTile 把图标放进浅底方块，否则图标直接替换竖杠', () => {
    const tile = mount(() => <MxPanel title="选择查看报表" iconTile>{{ icon }}</MxPanel>);
    const plain = mount(() => <MxPanel title="选择查看报表">{{ icon }}</MxPanel>);

    expect(tile.find('[class*="_tile_"] [data-test="icon"]').exists()).toBe(true);
    expect(plain.find('[class*="_tile_"]').exists()).toBe(false);
    expect(plain.find('[data-test="icon"]').exists()).toBe(true);
    expect(plain.find('[class*="_mark_"]').exists()).toBe(false);
  });
});
