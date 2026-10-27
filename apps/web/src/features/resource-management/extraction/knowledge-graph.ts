import { z } from 'zod';
import raw from './knowledge-graph.json';

// 自助取数用的知识图谱：旧项目 knowledge-graph-enterprise/data/data.json 原样迁入（246 个节点、301 条关系）
const nodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['root', 'system', 'survey-category', 'survey-detail', 'planning-category', 'planning-detail']),
  system: z.enum(['', 'survey', 'planning']),
  level: z.number().int().nullable(),
  code: z.string(),
  name: z.string(),
  levelName: z.string(),
  parentId: z.string().nullable()
});

const edgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.enum(['contains', 'mapping'])
});

const dataSchema = z.object({ nodes: z.array(nodeSchema), edges: z.array(edgeSchema) });

export interface KnowledgeNode extends z.infer<typeof nodeSchema> {
  /** 图上显示的名称：规划体系的全称太长，和旧页面一样换成简称 */
  displayName: string;
  /** 所属分类体系的全称，根节点和体系节点为空 */
  systemName: string;
}

export interface KnowledgeEdge extends z.infer<typeof edgeSchema> {
  id: string;
}

export interface KnowledgeGraph {
  nodes: readonly KnowledgeNode[];
  edges: readonly KnowledgeEdge[];
}

const data = dataSchema.parse(raw);
const systemNames = new Map(data.nodes.filter(node => node.type === 'system').map(node => [node.id, node.name]));

export const knowledgeNodes: readonly KnowledgeNode[] = data.nodes.map(node => ({
  ...node,
  displayName: node.id === 'planning' ? '国土空间用地用海分类' : node.name,
  systemName: systemNames.get(node.system) ?? ''
}));

// 关系的编号带上数据里的序号：同一对节点之间可能有多条关系
export const knowledgeEdges: readonly KnowledgeEdge[] = data.edges.map(({ source, target, type }, index) => ({
  source,
  target,
  type,
  id: `${source}->${target}:${index}`
}));

const nodesById = new Map(knowledgeNodes.map(node => [node.id, node]));
const childrenById = new Map<string, KnowledgeNode[]>();
for (const node of knowledgeNodes) {
  if (node.parentId !== null) {
    childrenById.set(node.parentId, [...(childrenById.get(node.parentId) ?? []), node]);
  }
}

/** 节点的直接子级，按数据顺序 */
export function childrenOf(id: string): readonly KnowledgeNode[] {
  return childrenById.get(id) ?? [];
}

/**
 * 按业务名称搜索：关键词去掉首尾空白后必须含中文，匹配名称、简称或标签（标签是"编码 名称"）。
 * 旧页面先按名称找、进入图谱后再按编号和名称找一遍，只有简称命中时退回第一次的结果；对这份数据两种写法结果相同，合成一次
 */
export function searchKnowledgeNodes(keyword: string): KnowledgeNode[] {
  const text = keyword.trim().toLowerCase();
  if (!/\p{Script=Han}/u.test(text)) {
    return [];
  }
  return knowledgeNodes.filter(node => {
    return [node.name, node.displayName, node.label].some(value => value.toLowerCase().includes(text));
  });
}

/**
 * 搜索结果周围的子图：每个命中节点到根的路径、直接子级（规划一级类再带上三级类），
 * 以及和它有对应关系的节点的同样内容。节点和关系的顺序与旧页面一致，力导布局的结果依赖这个顺序
 */
export function searchContext(matches: readonly KnowledgeNode[]): KnowledgeGraph {
  const ids = new Set<string>();

  function addContext(node: KnowledgeNode) {
    const path: string[] = [];
    for (let current: KnowledgeNode | undefined = node; current; current = parentOf(current)) {
      path.unshift(current.id);
    }
    path.forEach(id => ids.add(id));
    for (const child of childrenOf(node.id)) {
      ids.add(child.id);
      if (isPlanningCategory(node) || isPlanningCategory(child)) {
        childrenOf(child.id).forEach(grandchild => ids.add(grandchild.id));
      }
    }
  }

  for (const node of matches) {
    addContext(node);
    for (const other of mappedNodes(node)) {
      addContext(other);
    }
  }
  return {
    nodes: [...ids].map(id => requiredNode(id)),
    edges: knowledgeEdges.filter(edge => ids.has(edge.source) && ids.has(edge.target))
  };
}

function parentOf(node: KnowledgeNode): KnowledgeNode | undefined {
  return node.parentId === null ? undefined : nodesById.get(node.parentId);
}

function isPlanningCategory(node: KnowledgeNode): boolean {
  return node.system === 'planning' && node.level === 1;
}

// 和节点有对应关系的另一端，按关系的数据顺序
function mappedNodes(node: KnowledgeNode): KnowledgeNode[] {
  return knowledgeEdges.flatMap(edge => {
    if (edge.type !== 'mapping') {
      return [];
    }
    if (edge.source === node.id) {
      return [requiredNode(edge.target)];
    }
    return edge.target === node.id ? [requiredNode(edge.source)] : [];
  });
}

// 关系两端和父节点都在数据里，由测试保证
function requiredNode(id: string): KnowledgeNode {
  const node = nodesById.get(id);
  if (!node) {
    throw new Error(`知识图谱里没有节点 ${id}`);
  }
  return node;
}
