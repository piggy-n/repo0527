// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { required } from '@/shared/testing/required';
import type { GraphEdgeKind } from './graph-model';
import { searchContext, searchKnowledgeNodes } from './knowledge-graph';
import { buildLegacyView, DENSE_NODES, initialCollapsed, type LegacyViewState, legacyNodeDetail } from './legacy-view';

function state(keyword: string, partial: Partial<LegacyViewState> = {}): LegacyViewState {
  const matches = searchKnowledgeNodes(keyword);
  return {
    keyword,
    context: searchContext(matches),
    matches,
    collapsed: new Set(),
    kinds: new Set<GraphEdgeKind>(['contains', 'class-mapping']),
    ...partial
  };
}

describe('buildLegacyView', () => {
  it('根节点带上检索词；命中的节点做了标记；关系按上下级和对应分开', () => {
    const view = buildLegacyView(state('耕地'));

    expect(view.nodes[0]).toMatchObject({ id: 'root', kind: 'root', name: '“耕地”关联知识图谱', category: 'root' });
    expect(view.nodes.find(node => node.id === 'planning')).toMatchObject({ kind: 'system', name: '国土空间用地用海分类' });
    expect(view.nodes.filter(node => node.match).map(node => node.id)).toEqual(['S01', 'P01', 'P23-2302']);
    expect(view.counts).toEqual({ contains: 12, 'class-mapping': 4 });
    expect(view.edges.filter(edge => edge.source === 'root').map(edge => edge.label)).toEqual(['分类体系', '分类体系']);
    expect(view.edges.find(edge => edge.kind === 'class-mapping')?.label).toBe('分类对应');
  });

  it('上下级的线按层级算深度，越往下越深', () => {
    const view = buildLegacyView(state('耕地'));
    const depth = (target: string) => view.edges.find(edge => edge.target === target && edge.kind === 'contains')?.depth;

    expect([depth('survey'), depth('S01'), depth('S01-0101')]).toEqual([0, 1, 2]);
  });

  it('收起的节点隐藏下级，标出个数；关掉的关系类型不画但照样计数', () => {
    const collapsed = buildLegacyView(state('耕地', { collapsed: new Set(['S01']) }));
    const parent = required(collapsed.nodes.find(node => node.id === 'S01'), '耕地');

    expect(collapsed.nodes.some(node => node.id === 'S01-0101')).toBe(false);
    expect(parent).toMatchObject({ childCount: 3, hiddenChildren: 3 });

    const noMapping = buildLegacyView(state('耕地', { kinds: new Set<GraphEdgeKind>(['contains']) }));
    expect(noMapping.edges.some(edge => edge.kind === 'class-mapping')).toBe(false);
    expect(noMapping.counts['class-mapping']).toBe(4);
  });
});

describe('initialCollapsed', () => {
  it('小图都展开；大图收起到一级类', () => {
    expect(initialCollapsed(searchContext(searchKnowledgeNodes('耕地'))).size).toBe(0);

    const large = state('用地');
    const collapsed = initialCollapsed(large.context);
    const view = buildLegacyView({ ...large, collapsed });
    expect(large.context.nodes.length).toBeGreaterThan(DENSE_NODES);
    expect(view.nodes.length).toBeLessThanOrEqual(DENSE_NODES);
    expect(view.nodes.every(node => node.level === null || node.level === 1)).toBe(true);
    expect(view.nodes.filter(node => node.hiddenChildren > 0).length).toBe(collapsed.size);
  });
});

describe('legacyNodeDetail', () => {
  const context = searchContext(searchKnowledgeNodes('耕地'));

  it('列出层级、对应关系和这张图里的下级', () => {
    const detail = legacyNodeDetail(context, 'S01');

    expect(detail).toMatchObject({ name: '耕地', isTarget: true });
    expect(detail.meta).toBe('国土调查工作分类 · 一级类');
    expect(detail.children.map(node => node.id)).toEqual(['S01-0101', 'S01-0102', 'S01-0103']);
    expect(detail.path).toEqual([]);
  });

  it('对应的另一端和上级都能定位', () => {
    const detail = legacyNodeDetail(context, 'S01-0101');

    expect(detail.path.map(node => node.id)).toEqual(['S01']);
    expect(detail.relations.map(relation => [relation.kind, relation.other.id])).toEqual([['class-mapping', 'P01-0101']]);
    expect(detail.relations.every(relation => context.nodes.some(node => node.id === relation.other.id))).toBe(true);
  });
});
