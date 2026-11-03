// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { required } from '@/shared/testing/required';
import type { GraphEdgeKind } from './graph-model';
import { RELATION_KINDS, waterGraph } from './relation-graph';
import {
  buildRelationView,
  RELATION_ROOT_ID,
  relationAncestors,
  relationChildren,
  relationNodeDetail,
  type RelationViewState
} from './relation-view';

const ALL_KINDS: readonly GraphEdgeKind[] = ['organize', 'contains', ...RELATION_KINDS];

function view(state: Partial<RelationViewState> = {}) {
  return buildRelationView(waterGraph, {
    keyword: '',
    hiddenProducts: new Set(),
    kinds: new Set(ALL_KINDS),
    collapsed: new Set(),
    ...state
  });
}

const edgeKeys = (kind: GraphEdgeKind, state: Partial<RelationViewState> = {}) =>
  view(state)
    .edges.filter(edge => edge.kind === kind)
    .map(edge => `${edge.source}->${edge.target}:${edge.label}`);

describe('图上的上下级', () => {
  it('总节点 → 大类 → 一级类和数据表 → 下级分类', () => {
    expect(relationChildren(waterGraph, RELATION_ROOT_ID)).toEqual([
      'land-use',
      'land-survey',
      'urban-monitoring',
      'water-survey'
    ]);
    expect(relationChildren(waterGraph, 'land-survey')).toEqual(['land-survey/11', 'land-survey/DLTB']);
    expect(relationChildren(waterGraph, 'land-use/17')).toHaveLength(6);
    expect(relationAncestors(waterGraph, 'urban-monitoring/130A01')).toEqual([
      'root',
      'urban-monitoring',
      'urban-monitoring/13',
      'urban-monitoring/130A'
    ]);
    expect(relationAncestors(waterGraph, 'land-use')).toEqual(['root']);
    expect(relationAncestors(waterGraph, RELATION_ROOT_ID)).toEqual([]);
  });
});

describe('buildRelationView', () => {
  it('默认全部展开：总节点、四个大类和 35 个数据节点', () => {
    const result = view();

    expect(result.nodes).toHaveLength(40);
    expect(result.nodes[0]).toMatchObject({ id: 'root', kind: 'root', name: '水资源知识图谱', category: 'root' });
    expect(result.nodes.filter(node => node.kind === 'system').map(node => node.name)).toEqual([
      '用地用海分类',
      '国土调查分类',
      '城市国土空间监测分类',
      '水资源基础调查分类'
    ]);
    expect(result.nodes.find(node => node.id === 'land-survey/DLTB')).toMatchObject({
      kind: 'dataset',
      category: 'dataset',
      level: null
    });
    expect(result.nodes.find(node => node.id === 'land-survey/1101')).toMatchObject({
      kind: 'class',
      code: '1101',
      level: 2,
      category: 'survey-2'
    });
  });

  it('总节点连四个大类，关系名称各不相同；这是单独的组织关系，不混进数据里的关系', () => {
    expect(edgeKeys('organize')).toEqual([
      'root->land-use:规划用途',
      'root->land-survey:现状调查',
      'root->urban-monitoring:城市监测',
      'root->water-survey:专项调查'
    ]);
    expect(waterGraph.relations.some(relation => relation.source === 'root' || relation.target === 'root')).toBe(false);
    expect(view().counts).toMatchObject({ organize: 4, 'class-mapping': 6, temporal: 3, 'field-mapping': 0, spatial: 0 });
  });

  it('保留用地用海和国土调查的子节点对应、水资源基础调查的时序关联', () => {
    expect(edgeKeys('class-mapping')).toEqual([
      'land-survey/1101->land-use/1701:分类对应',
      'land-survey/1102->land-use/1702:分类对应',
      'land-survey/1103->land-use/1703:分类对应',
      'land-survey/1104->land-use/1704:分类对应',
      'land-survey/1107->land-use/1705:分类对应',
      'land-survey/1110->land-use/1706:分类对应'
    ]);
    expect(edgeKeys('temporal')).toEqual([
      'water-survey/HL_FS->water-survey/HL_KS:时序关联',
      'water-survey/HP_FS->water-survey/HP_KS:时序关联',
      'water-survey/SK_FS->water-survey/SK_KS:时序关联'
    ]);
  });

  it('上下级写"包含"，大类到数据表写"数据表"，层级越深深度越大', () => {
    const { edges } = view();
    const edge = (target: string) => required(edges.find(item => item.id === `tree:${target}`), target);

    expect(edge('land-survey/DLTB')).toMatchObject({ label: '数据表', kind: 'contains', depth: 1 });
    expect(edge('land-survey/11')).toMatchObject({ label: '包含', depth: 1 });
    expect(edge('land-survey/1101')).toMatchObject({ label: '包含', depth: 2 });
    expect(edge('urban-monitoring/130A01')).toMatchObject({ depth: 3 });
  });

  it('收起的节点接住下级的关系：两端落在同一节点时不画，同一对节点合成一条', () => {
    const land = { collapsed: new Set(['land-use/17']) };
    const collapsed = view(land);

    expect(collapsed.nodes.some(node => node.id === 'land-use/1701')).toBe(false);
    expect(collapsed.nodes.find(node => node.id === 'land-use/17')).toMatchObject({ childCount: 6, hiddenChildren: 6 });
    expect(edgeKeys('class-mapping', land)[0]).toBe('land-survey/1101->land-use/17:分类对应');

    const both = { collapsed: new Set(['land-use/17', 'land-survey/11']) };
    expect(edgeKeys('class-mapping', both)).toEqual(['land-survey/11->land-use/17:分类对应 ×6']);
    const merged = required(view(both).edges.find(edge => edge.kind === 'class-mapping'), '合并的线');
    expect(merged.count).toBe(6);

    const period = view({ collapsed: new Set(['water-survey']) });
    expect(period.edges.some(edge => edge.kind === 'temporal')).toBe(false);
    expect(period.counts.temporal).toBe(0);
  });

  it('隐藏的数据成果连同总节点的线都不画，连到它的关系不计数；关掉的关系类型不画但照样计数', () => {
    const hidden = view({ hiddenProducts: new Set(['land-survey']) });

    expect(hidden.nodes.some(node => node.id === 'land-survey' || node.id === 'land-survey/11')).toBe(false);
    expect(hidden.counts['class-mapping']).toBe(0);
    expect(hidden.edges.filter(edge => edge.kind === 'organize')).toHaveLength(3);

    const noTemporal = view({ kinds: new Set<GraphEdgeKind>(['organize', 'contains', 'class-mapping']) });
    expect(noTemporal.edges.some(edge => edge.kind === 'temporal')).toBe(false);
    expect(noTemporal.counts.temporal).toBe(3);
  });

  it('检索只留命中节点、上级、直接下级和有关系的节点；总节点带上关键词；一端不在范围里的关系不画', () => {
    const river = view({ keyword: '河流' });

    expect([...river.matches]).toHaveLength(5);
    expect(river.nodes.find(node => node.id === 'root')?.name).toBe('“河流”关联知识图谱');
    expect(river.nodes.map(node => node.id)).toEqual([
      'root',
      'land-use',
      'land-use/17',
      'land-use/1701',
      'land-survey',
      'land-survey/11',
      'land-survey/1101',
      'urban-monitoring',
      'urban-monitoring/13',
      'urban-monitoring/130A',
      'urban-monitoring/130A01',
      'water-survey',
      'water-survey/FSQ',
      'water-survey/HL_FS',
      'water-survey/KSQ',
      'water-survey/HL_KS'
    ]);
    expect(river.nodes.filter(node => node.match)).toHaveLength(5);
    // 只有河流的一对分类对应和时序关联，其他 5 对不在范围里
    expect(river.edges.filter(edge => edge.kind === 'class-mapping' || edge.kind === 'temporal')).toHaveLength(2);

    expect(view({ keyword: '水域网络' }).nodes.filter(node => node.level === 3)).toHaveLength(6);
    expect(view({ keyword: '查无此项' }).scope.size).toBe(40);
    expect(view({ keyword: '查无此项' }).nodes[0].name).toBe('水资源知识图谱');
  });
});

describe('relationNodeDetail', () => {
  it('总节点：四条组织关系和说明，不是取数节点', () => {
    const detail = relationNodeDetail(waterGraph, RELATION_ROOT_ID);

    expect(detail).toMatchObject({ name: '水资源知识图谱', meta: '中心主题', isTarget: false });
    expect(detail.relations.map(relation => [relation.label, relation.other.name])).toEqual([
      ['规划用途', '用地用海分类'],
      ['现状调查', '国土调查分类'],
      ['城市监测', '城市国土空间监测分类'],
      ['专项调查', '水资源基础调查分类']
    ]);
    expect(detail.note).toContain('不改变');
  });

  it('大类：关系连到总节点，列出下级和下级分类的对应，不是取数节点', () => {
    const detail = relationNodeDetail(waterGraph, 'land-survey');

    expect(detail).toMatchObject({ name: '国土调查分类', meta: '分类体系 · 调查成果', isTarget: false });
    expect(detail.relations.map(relation => relation.other.id)).toEqual(['root']);
    expect(detail.children.map(node => node.id)).toEqual(['land-survey/11', 'land-survey/DLTB']);
    expect(detail.childRelations).toHaveLength(6);
    expect(relationNodeDetail(waterGraph, 'water-survey').childRelations).toEqual([]);
  });

  it('分类：层级、直接关系和所属数据成果的数据表', () => {
    const detail = relationNodeDetail(waterGraph, 'land-survey/1101');

    expect(detail).toMatchObject({ meta: '国土调查分类 · 二级类', isTarget: true, datasetsTitle: '国土调查分类的数据表' });
    expect(detail.path.map(node => node.code)).toEqual(['11']);
    expect(detail.relations.map(relation => [relation.kind, relation.other.id, relation.product])).toEqual([
      ['class-mapping', 'land-use/1701', '用地用海分类']
    ]);
    expect(detail.datasets.map(node => node.code)).toEqual(['DLTB']);
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
    expect(detail.datasets).toEqual([]);
    expect(detail.table?.fields).toHaveLength(28);
    expect(detail.isTarget).toBe(true);
  });
});
