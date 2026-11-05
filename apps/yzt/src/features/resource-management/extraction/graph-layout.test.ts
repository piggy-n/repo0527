// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { layoutGraph } from './graph-layout';
import type { GraphLayoutInput, GraphViewport } from './graph-model';
import { legacySeeds, waterSeeds } from './graph-seeds';
import { measureNodes } from './graph-text';
import { searchContext, searchKnowledgeNodes } from './knowledge-graph';
import { buildLegacyView, initialCollapsed } from './legacy-view';
import { RELATION_KINDS, waterGraph } from './relation-graph';
import { buildRelationView } from './relation-view';

function waterInput(): GraphLayoutInput {
  const { nodes, edges } = buildRelationView(waterGraph, {
    keyword: '',
    hiddenProducts: new Set(),
    kinds: new Set(['organize', 'contains', ...RELATION_KINDS]),
    collapsed: new Set()
  });
  return { key: 'water', nodes, edges, seeds: waterSeeds(waterGraph), mappingStrength: 0.07 };
}

function legacyInput(keyword: string, collapsed: ReadonlySet<string> = new Set()): GraphLayoutInput {
  const matches = searchKnowledgeNodes(keyword);
  const { nodes, edges } = buildLegacyView({
    keyword,
    context: searchContext(matches),
    matches,
    collapsed,
    kinds: new Set(['contains', 'class-mapping'])
  });
  return { key: `legacy:${keyword}`, nodes, edges, seeds: legacySeeds(), gap: 36 };
}

// 相距最近的两个节点边缘的距离（显示比例为 1）
function clearance(input: GraphLayoutInput, viewport: GraphViewport): number {
  const positions = layoutGraph(input, viewport);
  const nodes = measureNodes(input.nodes);
  let smallest = Infinity;
  nodes.forEach((a, index) => {
    for (const b of nodes.slice(index + 1)) {
      const p = positions.get(a.id) ?? { x: 0, y: 0 };
      const q = positions.get(b.id) ?? { x: 0, y: 0 };
      smallest = Math.min(smallest, Math.hypot(p.x - q.x, p.y - q.y) - (a.baseSize + b.baseSize) / 2);
    }
  });
  return smallest;
}

const WIDE = { width: 1134, height: 546 };
const SMALL = { width: 900, height: 414 };

describe('layoutGraph', () => {
  it('同一输入每次结果相同，不改动图谱数据', () => {
    const input = waterInput();
    const snapshot = JSON.stringify(input.nodes);

    expect([...layoutGraph(input, WIDE)]).toEqual([...layoutGraph(input, WIDE)]);
    expect(JSON.stringify(input.nodes)).toBe(snapshot);
  });

  it('水资源和常见检索的图，在常用画布上节点互不重叠，边缘之间留得下关系名称', () => {
    expect(clearance(waterInput(), WIDE)).toBeGreaterThanOrEqual(22);
    expect(clearance(legacyInput('耕地'), WIDE)).toBeGreaterThanOrEqual(22);
    expect(clearance(legacyInput('水'), WIDE)).toBeGreaterThanOrEqual(22);
    expect(clearance(waterInput(), SMALL)).toBeGreaterThanOrEqual(0);
  });

  it('铺满画布：横向比纵向拉得开，不出画布', () => {
    const input = waterInput();
    const positions = [...layoutGraph(input, WIDE).values()];
    const xs = positions.map(point => point.x);
    const ys = positions.map(point => point.y);

    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(WIDE.width * 0.7);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(WIDE.height * 0.6);
    expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(WIDE.width / 2);
    expect(Math.max(...ys.map(Math.abs))).toBeLessThanOrEqual(WIDE.height / 2);
  });

  it('总节点在四个大类中间；成对的对应分类分在两侧', () => {
    const positions = layoutGraph(waterInput(), WIDE);
    const at = (id: string) => positions.get(id) ?? { x: NaN, y: NaN };

    expect(at('land-survey').x).toBeLessThan(at('root').x);
    expect(at('land-use').x).toBeGreaterThan(at('root').x);
    expect(at('land-survey/1101').x).toBeLessThan(at('land-use/1701').x);
    expect(at('land-survey/1110').x).toBeLessThan(at('land-use/1706').x);
  });

  it('只有一个节点时放在中心', () => {
    const [root] = waterInput().nodes;

    expect([...layoutGraph({ key: 'one', nodes: [root], edges: [], seeds: new Map() }, WIDE).values()]).toEqual([
      { x: 0, y: 0 }
    ]);
  });

  it('大图收起到一级类后也放得下', () => {
    const matches = searchKnowledgeNodes('用地');
    const context = searchContext(matches);
    const input = legacyInput('用地', initialCollapsed(context));

    expect(input.nodes.length).toBeLessThan(context.nodes.length);
    expect(clearance(input, WIDE)).toBeGreaterThanOrEqual(0);
  });
});
