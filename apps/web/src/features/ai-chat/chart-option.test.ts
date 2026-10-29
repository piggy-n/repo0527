// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ChatChart } from './chat-result';
import { axisValue, chartOption, tooltipValue } from './chart-option';

const chart = (overrides: Partial<ChatChart> = {}): ChatChart => ({
  title: '分类统计',
  type: 'bar',
  labels: ['水田', '旱地'],
  values: [42658273.89, 7919329.2],
  valueLabel: '面积(亩)',
  ...overrides
});

const labels = (count: number) => Array.from({ length: count }, (_, index) => `地类${index}`);

describe('chartOption', () => {
  it('柱状图：分类不多时没有滑动条，标签不斜放', () => {
    const option = chartOption(chart());

    expect(option.series).toEqual([expect.objectContaining({ type: 'bar', name: '面积(亩)' })]);
    expect(option.dataZoom).toEqual([]);
    expect(option.xAxis).toMatchObject({ axisLabel: { rotate: 0 } });
  });

  it('分类多时出现滑动条，标签斜放', () => {
    const many = labels(20);
    const option = chartOption(chart({ labels: many, values: many.map((_, index) => index) }));

    expect(option.dataZoom).toEqual([expect.objectContaining({ type: 'slider', end: 50 }), { type: 'inside' }]);
    expect(option.xAxis).toMatchObject({ axisLabel: { rotate: 35, overflow: 'truncate' } });
  });

  it('折线图平滑；没有数值名称时用标题', () => {
    const option = chartOption(chart({ type: 'line', valueLabel: '' }));

    expect(option.series).toEqual([expect.objectContaining({ type: 'line', smooth: true, name: '分类统计' })]);
  });

  it('饼图按分类配对数值，用滚动图例', () => {
    const option = chartOption(chart({ type: 'pie' }));

    expect(option.legend).toMatchObject({ type: 'scroll' });
    expect(option.series).toEqual([
      expect.objectContaining({
        type: 'pie',
        data: [
          { name: '水田', value: 42658273.89 },
          { name: '旱地', value: 7919329.2 }
        ]
      })
    ]);
  });

  it('纵轴和提示框用各自的数值格式', () => {
    const option = chartOption(chart());

    expect(option.yAxis).toMatchObject({ axisLabel: { formatter: axisValue } });
    expect(option.tooltip).toMatchObject({ valueFormatter: tooltipValue });
  });
});

describe('数值格式', () => {
  it('坐标轴上的大数用"万"，提示框里加千分位', () => {
    expect(axisValue(42658273.89)).toBe('4265.8万');
    expect(axisValue(-12000)).toBe('-1.2万');
    expect(axisValue(1234.5)).toBe('1,234.5');
    expect(tooltipValue(7919329.2)).toBe('7,919,329.2');
    expect(tooltipValue('-')).toBe('-');
  });
});
