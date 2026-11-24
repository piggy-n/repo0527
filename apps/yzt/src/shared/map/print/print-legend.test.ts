// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { type LegendFont, type LegendItem, layoutPrintLegend, type PrintLegendBlock, wrapText } from './print-legend';

// 不用真的字体：各行的文字、过滤条件每个字 12 像素，其余 14
const measure = (text: string, font: LegendFont) => text.length * (font === 'label' || font === 'note' ? 12 : 14);

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

  it('过滤条件：有标题时写在标题下面、类别上面，只有一行时写在那一行下面、和文字对齐；在底色里按宽度分行', () => {
    const layout = layoutPrintLegend(
      [
        { ...block('学校面层（2025）', ['中小学', '高等院校']), filterNote: '只显示 类型：小学、普通高等学校本科院校' },
        { ...block(null, ['地类图斑（2022）']), filterNote: '只显示 地类：水田' }
      ],
      1000,
      measure
    );

    // 底色上下留 2、4；底色里左右 6、漏斗 14、隔 4：一组的宽 200 放 14 个字，一行的缩进 30、宽 170 放 11 个字
    expect(summary(layout.items)).toStrictEqual([
      ['title', 0, 16, '图例'],
      ['header', 0, 54, '学校面层（2025）'],
      ['note', 0, 82, '只显示 类型：小学、普通高等|学校本科院校'],
      ['row', 0, 130, '中小学'],
      ['row', 0, 154, '高等院校'],
      ['row', 0, 186, '地类图斑（2022）'],
      ['note', 0, 212, '只显示 地类：水田']
    ]);
    const notes = layout.items.flatMap(item => (item.kind === 'note' ? [[item.indent, item.width, item.height]] : []));
    expect(notes).toStrictEqual([
      [0, 200, 4 * 2 + 18 * 2],
      [30, 170, 4 * 2 + 18]
    ]);
    expect(layout.height).toBe(242 + 16);
  });

  it('过滤条件跟着标题和第一行换列：算上它整组放不下时整组换到新的一列；跨列时不重复', () => {
    const filtered = [
      block(null, ['学校点层（2025）']),
      { ...block('学校面层（2025）', ['中小学', '高等院校']), filterNote: '只显示 类型：小学' }
    ];
    // 不算过滤条件时这一组放得下（86 + 26 + 48 = 160 ≤ 184），算上它（再加 32）放不下
    const moved = layoutPrintLegend(filtered, 200, measure);
    const long = layoutPrintLegend(
      [{ ...block('地类图斑（2022）', ['0101 水田', '0102 水浇地', '0103 旱地', '0201 果园']), filterNote: '只显示 地类：水田' }],
      150,
      measure
    );

    expect(summary(moved.items).slice(2)).toStrictEqual([
      ['header', 1, 16, '学校面层（2025）'],
      ['note', 1, 44, '只显示 类型：小学'],
      ['row', 1, 74, '中小学'],
      ['row', 1, 98, '高等院校']
    ]);
    expect(long.columns).toBeGreaterThan(1);
    expect(long.items.filter(item => item.kind === 'note')).toHaveLength(1);
  });

  it('没有条目时只有图例两字', () => {
    const layout = layoutPrintLegend([], 1000, measure);

    expect(summary(layout.items)).toStrictEqual([['title', 0, 16, '图例']]);
    expect(layout.height).toBe(16 + 30 + 16);
  });
});
