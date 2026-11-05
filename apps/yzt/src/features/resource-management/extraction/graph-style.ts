import type { GraphEdgeKind } from './graph-model';
import type { KnowledgeNode } from './knowledge-graph';

// 知识图谱的配色属于图表，不进界面令牌（ADR 0126）

export type NodeCategoryId =
  | 'root'
  | 'system'
  | 'survey-1'
  | 'survey-2'
  | 'planning-1'
  | 'planning-2'
  | 'planning-3'
  | 'monitor-1'
  | 'monitor-2'
  | 'monitor-3'
  | 'water-1'
  | 'water-2'
  | 'dataset';

export interface NodeStyle {
  /** 图例里的名称 */
  label: string;
  fill: string;
  /** 名称的颜色，和底色的对比度不低于 4.5:1 */
  text: string;
  /** 外发光的颜色，带透明度 */
  glow: string;
  /** 边框；没写时是白色 */
  border?: string;
}

// 旧项目的色相，饱和度降低：白字的底色对白色不低于 4.5:1，琥珀、黄绿在白字下发浑，配深字。新增的两个数据成果按层级由深到浅
export const NODE_STYLES: Readonly<Record<NodeCategoryId, NodeStyle>> = {
  root: { label: '中心主题', fill: '#1f7ab8', text: '#ffffff', glow: '#38bdf866' },
  system: { label: '分类体系', fill: '#5f6f86', text: '#ffffff', glow: '#64748b66' },
  'survey-1': { label: '国土调查一级类', fill: '#d03f58', text: '#ffffff', glow: '#fb718566' },
  'survey-2': { label: '国土调查二级类', fill: '#ecae4b', text: '#33210a', glow: '#f59e0b66' },
  'planning-1': { label: '用地用海一级类', fill: '#94c34a', text: '#1c2a06', glow: '#84cc1666' },
  'planning-2': { label: '用地用海二级类', fill: '#8f5bd6', text: '#ffffff', glow: '#a855f766' },
  'planning-3': { label: '用地用海三级类', fill: '#c54e38', text: '#ffffff', glow: '#ef444466' },
  'monitor-1': { label: '城市监测分类', fill: '#147f76', text: '#ffffff', glow: '#14b8a666' },
  'monitor-2': { label: '城市监测分类', fill: '#46b5a9', text: '#06302b', glow: '#14b8a666' },
  'monitor-3': { label: '城市监测分类', fill: '#8fd6cc', text: '#06302b', glow: '#14b8a666' },
  'water-1': { label: '水资源调查分类', fill: '#3f73d6', text: '#ffffff', glow: '#60a5fa66' },
  'water-2': { label: '水资源调查分类', fill: '#94b6f0', text: '#0d2452', glow: '#60a5fa66' },
  dataset: { label: '数据表', fill: '#e6ebf2', text: '#1f2a3a', glow: '#94a3b866', border: '#7c8ba1' }
};

/** 水资源图的图例：同一个数据成果的几层算一类 */
export const WATER_LEGEND: readonly NodeCategoryId[] = [
  'root',
  'system',
  'survey-1',
  'survey-2',
  'planning-1',
  'planning-2',
  'monitor-1',
  'water-1',
  'dataset'
];

/** 其他资源的图例：旧图例的 7 类 */
export const KNOWLEDGE_LEGEND: readonly NodeCategoryId[] = [
  'root',
  'system',
  'survey-1',
  'survey-2',
  'planning-1',
  'planning-2',
  'planning-3'
];

/** 检索命中的描边和光晕：旧项目的琥珀色 */
export const MATCH_STYLE = { border: '#f59e0b', glow: '#f59e0b80' } as const;

export interface EdgeStyle {
  label: string;
  description: string;
  /** 线的颜色，和画布的对比度不低于 3:1 */
  color: string;
  /** 虚线的线段和间隔，实线为 null；线型和颜色一起区分关系，色弱时也能分辨 */
  dash: readonly number[] | null;
  /** 关系名称的颜色，和画布的对比度不低于 4.5:1 */
  text: string;
}

export const EDGE_STYLES: Readonly<Record<GraphEdgeKind, EdgeStyle>> = {
  organize: {
    label: '组织关系',
    description: '总节点和四个大类的组织关系，只用于展示，不代表数据之间的对应',
    color: '#64748b',
    dash: null,
    text: '#475569'
  },
  contains: { label: '包含', description: '分类的上下级', color: '#5b86d8', dash: null, text: '#55657a' },
  'class-mapping': {
    label: '分类对应',
    description: '不同数据成果之间的分类编码对应',
    color: '#c27c12',
    dash: [6, 4],
    text: '#8f5400'
  },
  temporal: {
    label: '时序关联',
    description: '同一类对象在不同时期的数据',
    color: '#0e9488',
    dash: [2, 4],
    text: '#0b6b62'
  },
  'field-mapping': {
    label: '字段映射',
    description: '数据表之间的字段对标、编码转换',
    color: '#15803d',
    dash: [8, 3],
    text: '#15803d'
  },
  spatial: {
    label: '空间关联',
    description: '要素之间的空间叠加、包含',
    color: '#be185d',
    dash: [10, 3, 2, 3],
    text: '#be185d'
  }
};

// 水资源图每个数据成果各层分类的类别，序号是层级减一
const PRODUCT_CATEGORIES: Readonly<Record<string, readonly NodeCategoryId[] | undefined>> = {
  'land-use': ['planning-1', 'planning-2', 'planning-3'],
  'land-survey': ['survey-1', 'survey-2'],
  'urban-monitoring': ['monitor-1', 'monitor-2', 'monitor-3'],
  'water-survey': ['water-1', 'water-2']
};

/** 水资源图里分类的类别；没登记的层级按数据表的样式，由测试保证数据里没有 */
export function classCategory(productId: string, level: number): NodeCategoryId {
  return PRODUCT_CATEGORIES[productId]?.[level - 1] ?? 'dataset';
}

/** 旧版知识图谱的节点属于图例的哪一类 */
export function knowledgeCategory(node: KnowledgeNode): NodeCategoryId {
  if (node.type === 'root' || node.type === 'system') {
    return node.type;
  }
  const system = node.system === 'planning' ? 'planning' : 'survey';
  if (node.level === 3) {
    return 'planning-3';
  }
  return node.level === 1 ? `${system}-1` : `${system}-2`;
}

/** 检索时总节点的名称 */
export function searchTitle(keyword: string): string {
  return `“${keyword}”关联知识图谱`;
}
