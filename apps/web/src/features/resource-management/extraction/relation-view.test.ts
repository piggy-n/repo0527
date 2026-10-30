// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { RELATION_KINDS, type RelationKind, waterGraph } from './relation-graph';
import { buildRelationView, type RelationTreeItem, relationNodeDetail, type RelationViewState } from './relation-view';

function view(state: Partial<RelationViewState> = {}) {
  return buildRelationView(waterGraph, {
    keyword: '',
    hiddenProducts: new Set(),
    kinds: new Set<RelationKind>(RELATION_KINDS),
    expanded: new Map(),
    ...state
  });
}

// 泳道里可见的节点编号，按显示顺序
function visible(items: readonly RelationTreeItem[]): string[] {
  return items.flatMap(item => [item.node.id, ...visible(item.children)]);
}

const edgeKeys = (state: Partial<RelationViewState> = {}) =>
  view(state).edges.map(edge => `${edge.kind}:${edge.from}->${edge.to}×${edge.relations.length}`);

describe('buildRelationView', () => {
  it('默认四条泳道全部展开，分类在前、数据表在后；全部关系都成线', () => {
    const result = view();

    expect(result.lanes.map(lane => [lane.product.id, lane.classCount, lane.datasets.length])).toEqual([
      ['land-use', 8, 0],
      ['land-survey', 7, 1],
      ['urban-monitoring', 8, 2],
      ['water-survey', 9, 0]
    ]);
    expect(visible(result.lanes[2].tree)).toEqual([
      'urban-monitoring/13',
      'urban-monitoring/130A',
      'urban-monitoring/130A01',
      'urban-monitoring/130A02',
      'urban-monitoring/130A03',
      'urban-monitoring/130A04',
      'urban-monitoring/130A05',
      'urban-monitoring/130A06'
    ]);
    expect(result.edges).toHaveLength(9);
    expect(result.counts).toEqual({ 'class-mapping': 6, temporal: 3, 'field-mapping': 0, spatial: 0 });
    // 线的起点在左边的泳道
    expect(edgeKeys()[0]).toBe('class-mapping:land-use/1701->land-survey/1101×1');
  });

  it('收起的节点接住下级的关系：两端落在同一节点时不画，同一对节点合成一条', () => {
    const collapsed = view({ expanded: new Map([['land-use/17', false]]) });

    expect(visible(collapsed.lanes[0].tree)).toEqual(['land-use/17', 'land-use/24']);
    expect(collapsed.lanes[0].tree[0]).toMatchObject({ open: false, childCount: 6, children: [] });
    expect(collapsed.representatives.get('land-use/1701')).toBe('land-use/17');
    expect(collapsed.edges.filter(edge => edge.from === 'land-use/17')).toHaveLength(6);

    const both = view({
      expanded: new Map([
        ['land-use/17', false],
        ['land-survey/11', false]
      ])
    });
    expect(both.edges.filter(edge => edge.kind === 'class-mapping').map(edge => edge.relations.length)).toEqual([6]);

    const folded = { expanded: new Map([['water-survey/FSQ', false]]) };
    const periods = view(folded);
    expect(edgeKeys(folded).filter(key => key.startsWith('temporal'))).toEqual(
      [
        'temporal:water-survey/FSQ->water-survey/HL_KS×1',
        'temporal:water-survey/FSQ->water-survey/HP_KS×1',
        'temporal:water-survey/FSQ->water-survey/SK_KS×1'
      ]
    );
    expect(periods.counts.temporal).toBe(3);
  });

  it('隐藏的数据成果没有泳道，连到它的关系不画也不计数；关掉的关系类型不画但照样计数', () => {
    const hidden = view({ hiddenProducts: new Set(['land-survey']) });

    expect(hidden.lanes.map(lane => lane.product.id)).toEqual(['land-use', 'urban-monitoring', 'water-survey']);
    expect(hidden.lanes.map(lane => lane.productIndex)).toEqual([0, 2, 3]);
    expect(hidden.counts['class-mapping']).toBe(0);
    expect(hidden.edges.map(edge => edge.kind)).toEqual(['temporal', 'temporal', 'temporal']);

    const noTemporal = view({ kinds: new Set<RelationKind>(['class-mapping']) });
    expect(noTemporal.edges).toHaveLength(6);
    expect(noTemporal.counts.temporal).toBe(3);
  });

  it('检索只留命中节点、上级、直接下级和有关系的节点；没有命中时显示全部', () => {
    const river = view({ keyword: '河流' });

    expect([...river.matches]).toHaveLength(5);
    expect(river.lanes.map(lane => visible(lane.tree))).toEqual([
      ['land-use/17', 'land-use/1701'],
      ['land-survey/11', 'land-survey/1101'],
      ['urban-monitoring/13', 'urban-monitoring/130A', 'urban-monitoring/130A01'],
      ['water-survey/FSQ', 'water-survey/HL_FS', 'water-survey/KSQ', 'water-survey/HL_KS']
    ]);
    expect(river.lanes.every(lane => lane.datasets.length === 0)).toBe(true);
    expect(river.edges).toHaveLength(2);

    const network = view({ keyword: '水域网络' });
    expect(visible(network.lanes[0].tree)).toHaveLength(8);

    expect(view({ keyword: '查无此项' }).scope.size).toBe(waterGraph.nodes.size);
  });
});

describe('relationNodeDetail', () => {
  it('分类：层级、直接关系和所属数据成果的数据表', () => {
    const detail = relationNodeDetail(waterGraph, 'land-survey/1101');

    expect(detail.product.name).toBe('国土调查');
    expect(detail.path.map(node => node.code)).toEqual(['11']);
    expect(detail.relations.map(link => [link.relation.kind, link.other.id])).toEqual([
      ['class-mapping', 'land-use/1701']
    ]);
    expect(detail.productDatasets.map(node => node.code)).toEqual(['DLTB']);
  });

  it('上级分类列出下级和子树以外节点的关系，子树内部的关系不算', () => {
    const land = relationNodeDetail(waterGraph, 'land-use/17');
    expect(land.children).toHaveLength(6);
    expect(land.childRelations.map(link => `${link.inner.code}-${link.other.code}`)).toEqual([
      '1701-1101',
      '1702-1102',
      '1703-1103',
      '1704-1104',
      '1705-1107',
      '1706-1110'
    ]);

    expect(relationNodeDetail(waterGraph, 'water-survey/FSQ').childRelations).toHaveLength(3);
  });

  it('数据表没有上级，也不再列所属数据成果的数据表', () => {
    const detail = relationNodeDetail(waterGraph, 'urban-monitoring/HYDA');

    expect(detail.path).toEqual([]);
    expect(detail.productDatasets).toEqual([]);
    expect(detail.node.table?.fields).toHaveLength(28);
  });
});
