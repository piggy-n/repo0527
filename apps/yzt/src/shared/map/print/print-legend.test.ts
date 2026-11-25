// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { type LegendFont, type LegendItem, layoutPrintLegend, type PrintLegendBlock, wrapText } from './print-legend';

// 不用真的字体：各行的文字每个字 12 像素，其余 14
const measure = (text: string, font: LegendFont) => text.length * (font === 'label' ? 12 : 14);

const row = (label: string) => ({ label, drawSwatch: () => undefined });

function block(title: string | null, labels: readonly string[], continued?: string): PrintLegendBlock {
  return { title, rows: labels.map(row), ...(continued === undefined ? {} : { continued }) };
}

// 每个字 12 像素
const width = (text: string) => text.length * 12;

// 排好的各项，只看种类、列、位置和文字
const summary = (items: readonly LegendItem[]) =>
  items.map(item => [item.kind, item.column, item.y, item.lines.join('|')] as const);

// 组的标题：在第几列、写的什么
const headers = (items: readonly LegendItem[]) =>
  items.flatMap(item => (item.kind === 'header' ? [`${item.column}:${item.lines.join('')}`] : []));

describe('wrapText', () => {
  it('按宽度分行，放不下的字挪到下一行；空文字没有行', () => {
    expect(wrapText('城镇村道路用地', 36, width)).toStrictEqual(['城镇村', '道路用', '地']);
    expect(wrapText('水田', 36, width)).toStrictEqual(['水田']);
    expect(wrapText('', 36, width)).toStrictEqual([]);
  });

  it('一个字也放不下时照样各占一行，不会死循环', () => {
    expect(wrapText('水田', 5, () => 12)).toStrictEqual(['水', '田']);
  });
});

describe('layoutPrintLegend', () => {
  const blocks = [block(null, ['学校点层（2025）']), block('地类图斑（2022）', ['0101 水田', '0103 旱地', '0201 果园'])];

  it('放得下时一列：图例两字在最上面，单独一行的资源、带标题的一组依次往下，组之间空 8', () => {
    const layout = layoutPrintLegend(blocks, 1000, measure);

    expect(summary(layout.items)).toStrictEqual([
      ['title', 0, 16, '图例'],
      ['row', 0, 54, '学校点层（2025）'],
      ['header', 0, 86, '地类图斑（2022）'],
      ['row', 0, 112, '0101 水田'],
      ['row', 0, 136, '0103 旱地'],
      ['row', 0, 160, '0201 果园']
    ]);
    expect([layout.columns, layout.width, layout.height]).toStrictEqual([1, 232, 200]);
    expect(layout.items.flatMap(item => (item.kind === 'row' ? [item.font] : []))).toStrictEqual([
      'strong',
      'label',
      'label',
      'label'
    ]);
  });

  it('放不下时换到右边一列：组的标题带着它的第一行一起换', () => {
    const layout = layoutPrintLegend(blocks, 150, measure);

    expect(summary(layout.items)).toStrictEqual([
      ['title', 0, 16, '图例'],
      ['row', 0, 54, '学校点层（2025）'],
      ['header', 1, 16, '地类图斑（2022）'],
      ['row', 1, 42, '0101 水田'],
      ['row', 1, 66, '0103 旱地'],
      ['row', 1, 90, '0201 果园']
    ]);
    expect([layout.columns, layout.width, layout.height]).toStrictEqual([2, 464, 130]);
  });

  it('一组跨列时新的一列开头写续的标题，没给时是"标题（续）"；每列都不超过最高的高度', () => {
    const labels = ['0101 水田', '0102 水浇地', '0103 旱地', '0201 果园', '0202 茶园', '0301 乔木林地'];
    const named = layoutPrintLegend([block('地类图斑（2022）', labels, '地类图斑（2022，续）')], 150, measure);
    const plain = layoutPrintLegend([block('三维模型', labels)], 150, measure);

    expect(headers(named.items)).toStrictEqual(['0:地类图斑（2022）', '1:地类图斑（2022，续）', '2:地类图斑（2022，续）']);
    expect(headers(plain.items)).toStrictEqual(['0:三维模型', '1:三维模型（续）', '2:三维模型（续）']);
    expect(named.items.filter(item => item.kind === 'row')).toHaveLength(labels.length);
    for (const item of named.items) {
      const bottom = item.y + (item.kind === 'row' ? item.height : 26);
      expect(bottom).toBeLessThanOrEqual(150 - 16);
    }
  });

  it('一组放得进新的一列时整组换列，不拆成两列（这一列放得下标题和第一行，放不下第二行）', () => {
    const short = [block(null, ['学校点层（2025）']), block('行政区边界', ['省界', '市界'])];
    const layout = layoutPrintLegend(short, 160, measure);

    expect(summary(layout.items)).toStrictEqual([
      ['title', 0, 16, '图例'],
      ['row', 0, 54, '学校点层（2025）'],
      ['header', 1, 16, '行政区边界'],
      ['row', 1, 42, '省界'],
      ['row', 1, 66, '市界']
    ]);
  });

  it('文字太长时分行（一行宽 232 - 2 × 16 - 22 - 8 = 170，放 14 个字），这一行跟着变高', () => {
    const layout = layoutPrintLegend([block('地类', ['1004 城镇村道路用地和其他很长的名称说明'])], 1000, measure);
    const long = layout.items.find(item => item.kind === 'row');

    expect(long?.lines).toStrictEqual(['1004 城镇村道路用地和其', '他很长的名称说明']);
    expect(long?.kind === 'row' && long.height).toBe(24 + 18);
  });

  it('没有条目时只有图例两字', () => {
    const layout = layoutPrintLegend([], 1000, measure);

    expect(summary(layout.items)).toStrictEqual([['title', 0, 16, '图例']]);
    expect(layout.height).toBe(16 + 30 + 16);
  });
});
