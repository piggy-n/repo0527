// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { GraphNode } from './graph-model';
import {
  adaptiveFont,
  edgeFont,
  fitNameInCircle,
  LINE_RATIO,
  measureNodes,
  MIN_FONT,
  nodeSizeAt,
  textWidth
} from './graph-text';
import { knowledgeNodes } from './knowledge-graph';
import { waterGraph } from './relation-graph';

function node(partial: Partial<GraphNode>): GraphNode {
  return {
    id: 'n',
    name: '河流水面',
    code: '',
    kind: 'class',
    level: 2,
    category: 'survey-2',
    match: false,
    childCount: 0,
    hiddenChildren: 0,
    ...partial
  };
}

const measured = (partial: Partial<GraphNode>) => measureNodes([node(partial)])[0];
const lines = (name: string) => fitNameInCircle(name).lines;

// 每行的四个角到圆心的距离，字号为 1
function radiusNeeded(rows: readonly string[]): number {
  const total = rows.length * LINE_RATIO;
  return Math.max(
    ...rows.map((row, index) => {
      const top = index * LINE_RATIO - total / 2;
      return Math.hypot(textWidth(row) / 2, Math.max(Math.abs(top), Math.abs(top + LINE_RATIO)));
    })
  );
}

const allNames = [
  ...knowledgeNodes.map(item => item.displayName),
  ...[...waterGraph.nodes.values()].map(item => item.name),
  ...waterGraph.products.map(product => product.name),
  waterGraph.title
];

describe('fitNameInCircle', () => {
  it('在词之间折行，不把词拆开', () => {
    expect(lines('水资源调查监测成果知识图谱')).toEqual(['水资源', '调查监测成果', '知识图谱']);
    expect(lines('城市国土空间监测分类')).toEqual(['城市', '国土空间', '监测分类']);
    expect(lines('水资源基础调查分类')).toEqual(['水资源', '基础调查', '分类']);
    expect(lines('水域及水利设施用地')).toEqual(['水域及', '水利设施', '用地']);
    expect(lines('河流水面')).toEqual(['河流', '水面']);
  });

  it('分词器不认识的专业词不拆；标点跟着旁边的字', () => {
    expect(lines('用地用海分类')).toEqual(['用地用海', '分类']);
    expect(lines('丰水期河流')).toEqual(['丰水期', '河流']);
    expect(lines('“河流”关联知识图谱')).toEqual(['“河流”', '关联', '知识图谱']);
  });

  it('很短的名称写一行，不把三个字拆成两行', () => {
    expect(lines('丰水期')).toEqual(['丰水期']);
    expect(lines('沟渠')).toEqual(['沟渠']);
  });

  it('很长的名称不会卡住，也不丢字', () => {
    const long = '水域及水利设施用地'.repeat(30);
    const started = performance.now();
    const fit = fitNameInCircle(long);

    expect(performance.now() - started).toBeLessThan(1000);
    expect(fit.lines.join('')).toBe(long);
    expect(fit.lines.length).toBeLessThanOrEqual(5);
  });

  it('同一个名称只算一次', () => {
    expect(fitNameInCircle('城市国土空间监测分类')).toBe(fitNameInCircle('城市国土空间监测分类'));
  });

  it('全部名称都不丢字，算出的半径放得下每一行', () => {
    for (const name of allNames) {
      const fit = fitNameInCircle(name);
      expect(fit.lines.join('')).toBe(name.replace(/\s+/g, ''));
      expect(fit.radius).toBeCloseTo(radiusNeeded(fit.lines), 5);
    }
  });
});

describe('measureNodes', () => {
  it('长名称把圆撑大：12 号字放得下，所以不用截断', () => {
    const short = measured({ name: '沟渠' });
    const long = measured({ name: '海洋保护修复及海岸防护工程用海' });

    expect(long.baseSize).toBeGreaterThan(short.baseSize);
    expect(adaptiveFont(long, 1, 1)).toBeGreaterThanOrEqual(MIN_FONT);
  });

  it('全部名称在基准大小下都放得下下限字号，文字块在圆内', () => {
    for (const name of allNames) {
      const item = measured({ name });
      expect(adaptiveFont(item, 1, 1)).toBeGreaterThanOrEqual(MIN_FONT);
      expect(item.fitRadius * MIN_FONT).toBeLessThanOrEqual(item.baseSize / 2);
    }
  });

  it('层级越高节点越大、字越大', () => {
    const sizes = [
      measured({ kind: 'root', level: null, name: '根' }),
      measured({ kind: 'system', level: null, name: '体系' }),
      measured({ level: 1, name: '一级' }),
      measured({ level: 2, name: '二级' }),
      measured({ level: 3, name: '三级' })
    ].map(item => item.baseSize);

    expect(sizes).toEqual(sizes.toSorted((a, b) => b - a));
    expect(new Set(sizes).size).toBe(sizes.length);
    expect(measured({ level: 3 }).fontWeight).toBe(400);
    expect(measured({ level: 1 }).fontWeight).toBe(600);
  });

  it('收起的节点多写一行"+n"，圆也放得下', () => {
    const item = measured({ name: '陆地水域', hiddenChildren: 6, childCount: 6 });

    expect(item.labelText).toBe('陆地\n水域\n+6');
    expect(item.fitRadius).toBeGreaterThan(fitNameInCircle('陆地水域').radius);
    expect(adaptiveFont(item, 1, 1)).toBeGreaterThanOrEqual(MIN_FONT);
  });

  it('数据表是圆角矩形，宽度放得下名称', () => {
    const item = measured({ kind: 'dataset', level: null, name: '水利行业编码数据表', category: 'dataset' });

    expect(item.baseBox?.[0]).toBeGreaterThanOrEqual(9 * MIN_FONT);
    expect(item.labelText).toBe('水利行业编码数据表');
  });
});

describe('adaptiveFont', () => {
  const item = measured({ name: '冰川及永久积雪' });
  const root = measured({ kind: 'root', level: null, name: '水资源调查监测成果知识图谱' });

  it('字号随缩放变大，始终是不小于 12 的双数', () => {
    const fonts = [1, 1.25, 1.6, 2, 3, 4, 6].map(zoom => adaptiveFont(item, 1, zoom));

    expect(fonts).toEqual(fonts.toSorted((a, b) => a - b));
    expect(fonts.at(-1)).toBeGreaterThan(fonts[0]);
    expect(fonts.every(size => size >= MIN_FONT && size % 2 === 0)).toBe(true);
  });

  it('显示比例和缩放等效：大屏字更大', () => {
    expect(adaptiveFont(root, 1.2, 1)).toBe(adaptiveFont(root, 1, 1.2));
    expect(adaptiveFont(root, 1.2, 1)).toBeGreaterThan(adaptiveFont(root, 0.92, 1));
  });

  it('字不超出圆：字号乘所需半径不超过放大后的半径', () => {
    for (const zoom of [1, 1.3, 1.7, 2.4, 3.5, 6]) {
      const size = adaptiveFont(item, 1, zoom);
      expect(size * item.fitRadius).toBeLessThanOrEqual((item.baseSize * zoom) / 2);
    }
  });

  it('节点太小放不下下限字号时不画，而不是把字缩得看不清', () => {
    expect(adaptiveFont(item, 1, 0.4)).toBe(0);
    expect(adaptiveFont(item, 0.3, 1)).toBe(0);
  });

  it('显示比例不低于 0.6 时节点不缩到放不下 12 号字，名称不消失', () => {
    const long = measured({ name: '冰川及永久积雪' });

    expect(nodeSizeAt(long, 0.6)).toBe(long.minSize);
    expect(adaptiveFont(long, 0.6, 1)).toBe(MIN_FONT);
    expect(nodeSizeAt(long, 1.2)).toBe(long.baseSize * 1.2);
    expect(nodeSizeAt(long, 0.5)).toBe(long.baseSize * 0.5);
  });

  it('上限 40', () => {
    expect(adaptiveFont(root, 1, 50)).toBe(40);
  });
});

describe('edgeFont', () => {
  it('节点太小时关系名称放不下，放大后变成 14 号', () => {
    expect(edgeFont(0.5, 1)).toBe(0);
    expect(edgeFont(1, 1)).toBe(12);
    expect(edgeFont(1, 2)).toBe(14);
  });
});
