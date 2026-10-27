// @vitest-environment node
import type { GraphSeriesOption } from 'echarts/charts';
import { describe, expect, it } from 'vitest';
import { required } from '@/shared/testing/required';
import { type ChartTheme, knowledgeChartOption } from './graph-chart';
import { NODE_CATEGORIES } from './graph-style';
import { searchContext, searchKnowledgeNodes } from './knowledge-graph';

const theme: ChartTheme = {
  fontFamily: 'Alibaba PuHuiTi',
  text: '#2f3a4f',
  textSecondary: '#8a94a6',
  background: '#ffffff',
  primary: '#597ef7',
  warning: '#f0a020'
};
const viewport = { width: 760, height: 600 };

function series(keyword: string): GraphSeriesOption {
  const option = knowledgeChartOption(searchContext(searchKnowledgeNodes(keyword)), keyword, theme, viewport);
  const list = Array.isArray(option.series) ? option.series : [option.series];
  return required(list[0], '关系图系列');
}

interface ChartNode {
  id: string;
  name: string;
  symbolSize: number;
  label: { fontSize: number; fontWeight: number };
}

function nodes(keyword: string): ChartNode[] {
  return (series(keyword).data ?? []) as ChartNode[];
}

function nodeSizeOf(keyword: string, id: string): number {
  return required(nodes(keyword).find(node => node.id === id), id).symbolSize;
}

// 和白色的对比度，按 WCAG 的相对亮度
function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('knowledgeChartOption', () => {
  it('名称放在节点外，只用字体有的 400、600 字重和不小于 12 的双数字号', () => {
    const graph = series('地');
    const labels = nodes('地').map(node => node.label);

    expect(graph.label).toMatchObject({ show: true, position: 'bottom', overflow: 'break' });
    expect(new Set(labels.map(label => label.fontWeight))).toEqual(new Set([400, 600]));
    expect(labels.every(label => label.fontSize >= 12 && label.fontSize % 2 === 0)).toBe(true);
    expect(graph.labelLayout).toEqual({ hideOverlap: true });
  });

  it('根节点名称带上搜索的关键词，其余用简称', () => {
    const names = nodes('耕地').map(node => node.name);

    expect(names).toContain('“耕地”关联知识图谱');
    expect(names).toContain('国土空间用地用海分类');
  });

  it('节点按适配全图的比例缩小：节点多时比节点少时小，少时最多是布局直径的一半', () => {
    expect(nodeSizeOf('地', 'root')).toBeLessThan(nodeSizeOf('殡葬', 'root'));
    expect(nodeSizeOf('殡葬', 'root')).toBeLessThanOrEqual(145 / 2);
    expect(series('地').preserveAspect).toBe(true);
  });

  it('七类节点的颜色在白底上的对比度都不低于 4.5:1', () => {
    expect(NODE_CATEGORIES.filter(category => contrastWithWhite(category.color) < 4.5)).toEqual([]);
  });
});
