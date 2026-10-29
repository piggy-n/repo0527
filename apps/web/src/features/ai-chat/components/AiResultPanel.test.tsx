import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { required } from '@/shared/testing/required';
import type { ChatResult } from '../chat-result';
import { AiResultPanel } from './AiResultPanel';

// ECharts 在 jsdom 里没有画布，这里只检查结果区的排布，图表本身在页面验收
vi.mock('./ResultChart', async () => {
  const { defineComponent } = await import('vue');
  return { ResultChart: defineComponent({ name: 'ResultChart', setup: () => () => <div data-chart /> }) };
});

const result = (overrides: Partial<ChatResult> = {}): ChatResult => ({
  answer: '',
  geojson: null,
  chart: { title: '分类统计', type: 'bar', labels: ['水田'], values: [1], valueLabel: '面积(亩)' },
  table: {
    columns: ['编码', '面积(亩)'],
    rows: [
      { 编码: '0101', '面积(亩)': 42658273.891 },
      { 编码: '0102', '面积(亩)': null }
    ]
  },
  excelUrl: '/api/exports/download/a.xlsx',
  layerTag: '统计',
  stats: { durationMs: 12300, tokenCount: 981, tps: 1 },
  steps: [],
  ...overrides
});

function mountPanel(latest: ChatResult | null, expanded = true, maximized = false) {
  return mount(AiResultPanel, {
    props: { latest: latest && { question: '分类统计', result: latest }, expanded, maximized }
  });
}

const buttonByText = (wrapper: ReturnType<typeof mountPanel>, text: string) =>
  required(
    wrapper.findAll('button').find(button => button.text() === text),
    `"${text}"按钮`
  );

describe('AiResultPanel', () => {
  it('没有结果时只有标题', () => {
    const wrapper = mountPanel(null, false);

    expect(wrapper.text()).toBe('AI 查询结果');
    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('标题栏显示用量和分类，Excel 的路径补上 AI 后端的地址', () => {
    const wrapper = mountPanel(result());

    expect(wrapper.text()).toContain('12.3s · 981 tokens · 1 tok/s · 统计');
    expect(wrapper.get('a').attributes('href')).toBe(`${window.location.origin}/ai-backend/api/exports/download/a.xlsx`);
  });

  it('展开时图表、表格并排；数字加千分位，空值不渲染内容，交给全局样式显示"-"', async () => {
    const wrapper = mountPanel(result());

    expect(wrapper.find('[data-chart]').exists()).toBe(true);
    expect(wrapper.text()).toContain('2 条');
    // 列在挂载后才登记，等到单元格出现
    await vi.waitFor(() => expect(wrapper.findAll('.el-table__body td .cell')).toHaveLength(4));
    const cells = wrapper.findAll('.el-table__body td .cell');
    expect(cells.map(cell => cell.text())).toEqual(['0101', '42,658,273.89', '0102', '']);
    expect(cells[3]?.element.querySelector('*')).toBeNull();
  });

  it('收起时没有内容；展开、最大化通过事件交给页面，收起时退出最大化', async () => {
    const collapsed = mountPanel(result(), false);
    expect(collapsed.find('[data-chart]').exists()).toBe(false);
    expect(collapsed.findAll('button').map(button => button.text())).toEqual(['展开']);

    const wrapper = mountPanel(result(), true, true);
    await buttonByText(wrapper, '还原').trigger('click');
    await buttonByText(wrapper, '收起').trigger('click');

    expect(wrapper.emitted('update:maximized')).toEqual([[false], [false]]);
    expect(wrapper.emitted('update:expanded')).toEqual([[false]]);
  });

  it('只有地图或 Excel 时不能展开', () => {
    const wrapper = mountPanel(result({ chart: null, table: null }), false);

    expect(wrapper.findAll('button')).toHaveLength(0);
    expect(wrapper.find('a').exists()).toBe(true);
  });
});
