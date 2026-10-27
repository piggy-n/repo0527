import type { KnowledgeNode } from './knowledge-graph';

export type NodeCategoryId = 'root' | 'system' | 'survey-1' | 'survey-2' | 'planning-1' | 'planning-2' | 'planning-3';

export interface NodeCategory {
  id: NodeCategoryId;
  label: string;
  /** 节点填充色，和白色画布的对比度不低于 4.5:1 */
  color: string;
}

// 旧图例的 7 类节点。旧色（#38bdf8、#84cc16 等）在白底上对比度只有 2:1 左右，小节点看不清，这里换成同色系的深色；
// 国土调查用暖色、用地用海用冷色，三级类从旧的红色改为青色，和国土调查一级类区分开。图表配色不属于界面令牌
export const NODE_CATEGORIES: readonly NodeCategory[] = [
  { id: 'root', label: '中心主题', color: '#1d4ed8' },
  { id: 'system', label: '分类体系', color: '#475569' },
  { id: 'survey-1', label: '国土调查一级类', color: '#be123c' },
  { id: 'survey-2', label: '国土调查二级类', color: '#b45309' },
  { id: 'planning-1', label: '用地用海一级类', color: '#4d7c0f' },
  { id: 'planning-2', label: '用地用海二级类', color: '#7e22ce' },
  { id: 'planning-3', label: '用地用海三级类', color: '#0f766e' }
];

/** 节点属于图例的哪一类 */
export function nodeCategory(node: KnowledgeNode): NodeCategoryId {
  if (node.type === 'root' || node.type === 'system') {
    return node.type;
  }
  const system = node.system === 'planning' ? 'planning' : 'survey';
  if (node.level === 3) {
    return 'planning-3';
  }
  return node.level === 1 ? `${system}-1` : `${system}-2`;
}

/** 图上的名称：根节点显示这次搜索的关键词 */
export function nodeTitle(node: KnowledgeNode, keyword: string): string {
  return node.type === 'root' ? `“${keyword}”关联知识图谱` : node.displayName;
}
