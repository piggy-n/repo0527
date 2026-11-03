// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { classCategory, EDGE_STYLES, knowledgeCategory, NODE_STYLES, WATER_LEGEND } from './graph-style';
import { knowledgeNodes } from './knowledge-graph';
import { waterGraph } from './relation-graph';

// 按 WCAG 的相对亮度算对比度
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

// 画布的底色：--color-primary-bg-lighter
const CANVAS = '#fbfcff';

describe('知识图谱的配色', () => {
  it('节点的名称和底色对比度都不低于 4.5:1', () => {
    const low = Object.entries(NODE_STYLES).filter(([, style]) => contrast(style.fill, style.text) < 4.5);

    expect(low).toEqual([]);
  });

  it('关系线和画布不低于 3:1，关系名称不低于 4.5:1', () => {
    for (const style of Object.values(EDGE_STYLES)) {
      expect(contrast(style.color, CANVAS)).toBeGreaterThanOrEqual(3);
      expect(contrast(style.text, CANVAS)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('关系的线型互不相同：色弱时也能分辨', () => {
    const data = ['class-mapping', 'temporal', 'field-mapping', 'spatial'] as const;
    const dashes = data.map(kind => EDGE_STYLES[kind].dash?.join());

    expect(new Set(dashes).size).toBe(data.length);
    expect(EDGE_STYLES.contains.dash).toBeNull();
  });
});

describe('节点的类别', () => {
  it('水资源的每个分类都有自己的类别，图例覆盖四个数据成果', () => {
    const nodes = [...waterGraph.nodes.values()];
    const categories = nodes.map(node => (node.level === null ? 'dataset' : classCategory(node.productId, node.level)));

    expect(nodes.filter(node => node.level !== null && classCategory(node.productId, node.level) === 'dataset')).toEqual([]);
    expect(categories).toContain('monitor-3');
    for (const category of ['survey-1', 'survey-2', 'planning-1', 'planning-2', 'monitor-1', 'water-1', 'dataset'] as const) {
      expect(WATER_LEGEND).toContain(category);
    }
  });

  it('旧版知识图谱沿用旧图例的 7 类', () => {
    expect(new Set(knowledgeNodes.map(knowledgeCategory))).toEqual(
      new Set(['root', 'system', 'survey-1', 'survey-2', 'planning-1', 'planning-2', 'planning-3'])
    );
  });

  it('同一个地类在两张图里颜色相同', () => {
    const inLegacy = knowledgeCategory(knowledgeNodes.find(node => node.code === '1101' && node.system === 'survey') ?? knowledgeNodes[0]);

    expect(classCategory('land-survey', 2)).toBe(inLegacy);
  });
});
