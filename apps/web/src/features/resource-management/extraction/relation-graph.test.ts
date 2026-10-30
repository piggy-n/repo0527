// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  ancestorsOf,
  chooseExtractionGraph,
  createRelationGraph,
  relationNode,
  searchRelationNodes,
  waterGraph
} from './relation-graph';

const ids = (nodes: readonly { id: string }[]) => nodes.map(node => node.id);
const fields = (id: string) => relationNode(waterGraph, id).table?.fields?.length;

describe('水资源关系图数据', () => {
  it('四个数据成果，节点编号不重复，分类最多三级', () => {
    const nodes = [...waterGraph.nodes.values()];
    const total = waterGraph.products.length;

    expect(waterGraph.products.map(product => product.name)).toEqual([
      '用地用海分类',
      '国土调查',
      '城市国土空间监测',
      '水资源基础调查'
    ]);
    expect(total).toBe(4);
    expect(nodes).toHaveLength(35);
    expect(nodes.every(node => node.id === `${node.productId}/${node.code}`)).toBe(true);
    expect(Math.max(...nodes.map(node => node.level ?? 0))).toBe(3);
    expect(nodes.filter(node => node.level === null).map(node => node.code)).toEqual(['DLTB', 'HYDA', 'HYDL']);
  });

  it('关系两端都存在且不重复；分类对应跨数据成果，时序关联在同一数据成果内', () => {
    const keys = waterGraph.relations.map(relation => relation.id);
    // 每条关系：[种类, 两端是否在同一数据成果]；relationNode 在一端不存在时抛错
    const pairs = waterGraph.relations.map(relation => [
      relation.kind,
      relationNode(waterGraph, relation.source).productId === relationNode(waterGraph, relation.target).productId
    ]);

    expect(new Set(keys).size).toBe(keys.length);
    const mapping = Array.from({ length: 6 }, () => ['class-mapping', false]);
    const temporal = Array.from({ length: 3 }, () => ['temporal', true]);
    expect(pairs.filter(([kind]) => kind === 'class-mapping')).toEqual(mapping);
    expect(pairs.filter(([kind]) => kind === 'temporal')).toEqual(temporal);
    expect(pairs).toHaveLength(9);
  });

  it('只有给出了字段说明的表才有字段，不照同类的表补', () => {
    expect(fields('land-survey/DLTB')).toBe(7);
    expect(fields('urban-monitoring/HYDA')).toBe(28);
    expect(fields('water-survey/HL_FS')).toBe(13);
    expect(relationNode(waterGraph, 'urban-monitoring/HYDL').table?.fields).toBeUndefined();
    expect(relationNode(waterGraph, 'water-survey/HL_KS').table?.fields).toBeUndefined();
  });

  it('数据不合 schema 时报错', () => {
    expect(() => createRelationGraph({ name: '测试', products: [], relations: [{ kind: '包含' }] })).toThrow(ZodError);
  });
});

describe('关系图的查找', () => {
  it('上级从一级类排到直接上级', () => {
    expect(ancestorsOf(waterGraph, 'urban-monitoring/130A01')).toEqual([
      'urban-monitoring/13',
      'urban-monitoring/130A'
    ]);
    expect(ancestorsOf(waterGraph, 'land-use/17')).toEqual([]);
  });

  it('按名称或编码检索，忽略首尾空白和大小写；空白不检索', () => {
    expect(ids(searchRelationNodes(waterGraph, ' 河流 '))).toEqual([
      'land-use/1701',
      'land-survey/1101',
      'urban-monitoring/130A01',
      'water-survey/HL_FS',
      'water-survey/HL_KS'
    ]);
    expect(ids(searchRelationNodes(waterGraph, 'hl_fs'))).toEqual(['water-survey/HL_FS']);
    expect(searchRelationNodes(waterGraph, '  ')).toEqual([]);
  });
});

describe('chooseExtractionGraph', () => {
  it('命中的都在水资源关系图里时用新的关系图', () => {
    for (const keyword of ['河流', '湖泊', '水域', '冰川', 'HL_FS', '1101']) {
      expect(chooseExtractionGraph(keyword)).toBe('relation');
    }
  });

  it('其他资源和同时命中其他资源的检索词沿用旧版知识图谱；都没有命中时为 null', () => {
    for (const keyword of ['耕地', '湿地', '居住用地', '水']) {
      expect(chooseExtractionGraph(keyword)).toBe('legacy');
    }
    expect(chooseExtractionGraph('不存在的测试地类')).toBeNull();
    expect(chooseExtractionGraph('0101')).toBeNull();
  });
});
