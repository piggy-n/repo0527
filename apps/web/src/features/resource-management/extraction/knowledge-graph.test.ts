// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { required } from '@/shared/testing/required';
import { layoutGraph } from './graph-layout';
import { knowledgeEdges, knowledgeNodes, searchContext, searchKnowledgeNodes } from './knowledge-graph';
import legacy from './legacy-layout.fixture.json';

interface LegacyLayout {
  keyword: string;
  ids: string[];
  edges: string[];
  positions: Record<string, number[] | undefined>;
}

const fixtures: LegacyLayout[] = legacy;
const node = (id: string) => required(knowledgeNodes.find(item => item.id === id), `节点 ${id}`);

describe('知识图谱数据', () => {
  it('两套分类完整：关系两端都存在，包含关系和父子目录一致', () => {
    const ids = new Set(knowledgeNodes.map(item => item.id));

    const contains = knowledgeEdges.filter(edge => edge.type === 'contains');

    expect(knowledgeNodes).toHaveLength(246);
    expect(knowledgeEdges).toHaveLength(301);
    expect(ids.size).toBe(246);
    expect(knowledgeEdges.filter(edge => !ids.has(edge.source) || !ids.has(edge.target))).toEqual([]);
    expect(contains.map(edge => node(edge.target).parentId)).toEqual(contains.map(edge => edge.source));
    expect(node('S01-0101').systemName).toBe('国土调查工作分类');
    expect(node('planning').displayName).toBe('国土空间用地用海分类');
  });
});

describe('searchKnowledgeNodes', () => {
  it('关键词去掉首尾空白后按名称、简称和标签匹配，不限于热门词', () => {
    expect(searchKnowledgeNodes(' 旱地 ').map(item => item.id)).toEqual(['S01-0103', 'P01-0103']);
    expect(searchKnowledgeNodes('国土空间用地用海分类').map(item => item.id)).toEqual(['planning']);
    expect(searchKnowledgeNodes('殡葬')).not.toHaveLength(0);
  });

  it('不含中文的关键词不搜索：纯编码、英文和空白都没有结果', () => {
    for (const keyword of ['', '  ', '0103', 'P01', 'planning']) {
      expect(searchKnowledgeNodes(keyword)).toEqual([]);
    }
    expect(searchKnowledgeNodes('不存在的测试地类')).toEqual([]);
  });
});

describe('searchContext', () => {
  it('耕地的子图包括到根的路径、直接子级和对应的规划地类，不带无关的分类', () => {
    const graph = searchContext(searchKnowledgeNodes('耕地'));
    const ids = graph.nodes.map(item => item.id);

    expect(ids).toEqual(expect.arrayContaining(['root', 'survey', 'planning', 'S01', 'S01-0101', 'P01', 'P01-0103']));
    expect(ids).not.toContain('S00');
    expect(graph.edges.some(edge => edge.source === 'S01-0101' && edge.target === 'P01-0101')).toBe(true);
  });

  it('规划一级类带上它的三级类', () => {
    const graph = searchContext([node('P07')]);

    expect(graph.nodes.some(item => item.parentId !== null && item.level === 3)).toBe(true);
  });

  // 基准由旧项目 master-demo 的 graphData、GraphExpandManager、buildForceLayout 生成，不是用本实现算出来的
  it.each(fixtures)('「$keyword」的节点、关系顺序和力导坐标与旧页面一致', fixture => {
    const graph = searchContext(searchKnowledgeNodes(fixture.keyword));
    const snapshot = JSON.stringify(graph);
    const positions = layoutGraph(graph.nodes, graph.edges);

    expect(graph.nodes.map(item => item.id)).toEqual(fixture.ids);
    expect(graph.edges.map(edge => edge.id)).toEqual(fixture.edges);
    for (const [id, point] of Object.entries(fixture.positions)) {
      const [x, y] = required(point, `${id} 的旧坐标`);
      const actual = required(positions.get(id), `${id} 的新坐标`);
      expect(actual.x).toBeCloseTo(x, 5);
      expect(actual.y).toBeCloseTo(y, 5);
    }
    expect(JSON.stringify(graph)).toBe(snapshot);
  });
});
