import { z } from 'zod';
import { type KnowledgeNode, searchKnowledgeNodes } from './knowledge-graph';
import water from './water-relations.json';

// 自助取数的关系图：一个资源类别一份数据，数据成果下按层级列分类，节点编号是"数据成果/编码"。
// 数据结构和补充方式见 docs/modules/resource-management.md 的"水资源关系图"

export const RELATION_KINDS = ['class-mapping', 'temporal', 'field-mapping', 'spatial'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

const fieldSchema = z.object({
  code: z.string(),
  name: z.string(),
  type: z.string(),
  note: z.string().optional()
});

const tableSchema = z.object({
  title: z.string().optional(),
  geometry: z.enum(['点', '线', '面']).optional(),
  period: z.string(),
  // 没有字段说明的表不写 fields，不照同类的表补
  fields: z.array(fieldSchema).optional()
});

const classSchema = z.object({
  code: z.string(),
  name: z.string(),
  // 水资源基础调查的二级类本身就是一张表
  table: tableSchema.optional(),
  get children() {
    return z.array(classSchema).optional();
  }
});

const datasetSchema = z.object({ code: z.string(), name: z.string(), table: tableSchema });

const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  classes: z.array(classSchema),
  datasets: z.array(datasetSchema)
});

const relationSchema = z.object({ kind: z.enum(RELATION_KINDS), source: z.string(), target: z.string() });

const dataSchema = z.object({ name: z.string(), products: z.array(productSchema), relations: z.array(relationSchema) });

type RawClass = z.infer<typeof classSchema>;

export type RelationField = z.infer<typeof fieldSchema>;
export type RelationTable = z.infer<typeof tableSchema>;

export interface GraphRelation extends z.infer<typeof relationSchema> {
  id: string;
}

export interface RelationProduct {
  id: string;
  name: string;
  kind: string;
}

export interface RelationNode {
  id: string;
  productId: string;
  code: string;
  name: string;
  /** 分类的层级，从 1 开始；挂在数据成果下的数据表为 null */
  level: number | null;
  parentId: string | null;
  table: RelationTable | null;
}

export interface RelationGraph {
  name: string;
  products: readonly RelationProduct[];
  /** 按数据顺序：每个数据成果先列分类（深度优先），再列数据表 */
  nodes: ReadonlyMap<string, RelationNode>;
  children: ReadonlyMap<string, readonly string[]>;
  relations: readonly GraphRelation[];
}

/** 校验并展开一份关系图数据；节点编号重复或关系两端不存在由测试保证，这里不重复检查 */
export function createRelationGraph(data: unknown): RelationGraph {
  const parsed = dataSchema.parse(data);
  const nodes = new Map<string, RelationNode>();
  const children = new Map<string, string[]>();
  for (const product of parsed.products) {
    const addClass = (item: RawClass, level: number, parentId: string | null) => {
      const id = `${product.id}/${item.code}`;
      nodes.set(id, {
        id,
        productId: product.id,
        code: item.code,
        name: item.name,
        level,
        parentId,
        table: item.table ?? null
      });
      if (parentId !== null) {
        children.set(parentId, [...(children.get(parentId) ?? []), id]);
      }
      item.children?.forEach(child => addClass(child, level + 1, id));
    };
    product.classes.forEach(item => addClass(item, 1, null));
    for (const dataset of product.datasets) {
      const id = `${product.id}/${dataset.code}`;
      nodes.set(id, {
        id,
        productId: product.id,
        code: dataset.code,
        name: dataset.name,
        level: null,
        parentId: null,
        table: dataset.table
      });
    }
  }
  return {
    name: parsed.name,
    products: parsed.products.map(({ id, name, kind }) => ({ id, name, kind })),
    nodes,
    children,
    relations: parsed.relations.map(({ kind, source, target }) => ({
      id: `${kind}:${source}:${target}`,
      kind,
      source,
      target
    }))
  };
}

/** 水资源的关系图 */
export const waterGraph = createRelationGraph(water);

export function relationNode(graph: RelationGraph, id: string): RelationNode {
  const node = graph.nodes.get(id);
  if (!node) {
    throw new Error(`关系图里没有节点 ${id}`);
  }
  return node;
}

/** 从一级类到直接上级 */
export function ancestorsOf(graph: RelationGraph, id: string): string[] {
  const list: string[] = [];
  let parentId = relationNode(graph, id).parentId;
  while (parentId !== null) {
    list.unshift(parentId);
    parentId = relationNode(graph, parentId).parentId;
  }
  return list;
}

export function childrenOf(graph: RelationGraph, id: string): readonly string[] {
  return graph.children.get(id) ?? [];
}

export function relationsOf(graph: RelationGraph, id: string): GraphRelation[] {
  return graph.relations.filter(relation => relation.source === id || relation.target === id);
}

export function otherEnd(relation: GraphRelation, id: string): string {
  return relation.source === id ? relation.target : relation.source;
}

/** 按名称或编码检索，忽略首尾空白和大小写；名称相同不代表有关系，只用于高亮和缩小范围 */
export function searchRelationNodes(graph: RelationGraph, keyword: string): RelationNode[] {
  const text = keyword.trim().toLowerCase();
  if (!text) {
    return [];
  }
  return [...graph.nodes.values()].filter(node =>
    [node.name, node.code].some(value => value.toLowerCase().includes(text))
  );
}

const LEGACY_PRODUCTS = { survey: 'land-survey', planning: 'land-use' } as const;

// 旧图谱的分类在水资源关系图里对应的节点；根节点和体系节点没有
function legacyRelationId(node: KnowledgeNode): string | null {
  return node.system === '' ? null : `${LEGACY_PRODUCTS[node.system]}/${node.code}`;
}

export type ExtractionGraph = 'relation' | 'legacy';

/**
 * 检索词用哪张图：水资源关系图里有命中、旧图谱的命中也都在水资源关系图里，就用新的关系图；
 * 否则（其他资源）沿用旧版知识图谱；两边都没有命中时为 null
 */
export function chooseExtractionGraph(keyword: string): ExtractionGraph | null {
  const legacyMatches = searchKnowledgeNodes(keyword);
  const insideWater = legacyMatches.every(node => {
    const id = legacyRelationId(node);
    return id !== null && waterGraph.nodes.has(id);
  });
  if (searchRelationNodes(waterGraph, keyword).length > 0 && insideWater) {
    return 'relation';
  }
  return legacyMatches.length > 0 ? 'legacy' : null;
}
