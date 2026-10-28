/** 指标的两个分类页签，值是接口的 type */
export type IndicatorCategory = 'cstjpg' | 'zhfxzb';

export const INDICATOR_CATEGORIES: readonly { readonly id: IndicatorCategory; readonly label: string }[] = [
  { id: 'cstjpg', label: '城市体检评估' },
  { id: 'zhfxzb', label: '综合分析指标' }
];

/** 计算树上指标的计算状态 */
export type IndicatorStatus = 'pending' | 'processing' | 'done' | 'failed';

export const INDICATOR_STATUS_LABELS: Readonly<Record<IndicatorStatus, string>> = {
  pending: '未处理',
  processing: '正在处理',
  done: '处理完成',
  failed: '计算失败'
};

/** 一个指标（树的叶子） */
export interface IndicatorLeaf {
  readonly kind: 'leaf';
  /** 指标编码（接口的 dm），计算和选择都按它 */
  readonly code: string;
  /** 成果的记录 ID，展示成果时按它请求；只有展示树（/tree/out）有 */
  readonly dataId: string | null;
  readonly name: string;
  /** 接口标为禁用（sfjy）的指标不能选 */
  readonly disabled: boolean;
  /** 计算状态；接口没给时为 null，不显示标签 */
  readonly status: IndicatorStatus | null;
  /** 计算结果，如"40.04%" */
  readonly result: string | null;
  /** 失败等情况的原因 */
  readonly reason: string | null;
}

/** 指标的分类，可以多层 */
export interface IndicatorGroup {
  readonly kind: 'group';
  readonly code: string;
  readonly name: string;
  readonly children: readonly IndicatorTreeNode[];
}

export type IndicatorTreeNode = IndicatorGroup | IndicatorLeaf;

/** 全部指标，按树的顺序 */
export function indicatorLeaves(nodes: readonly IndicatorTreeNode[]): IndicatorLeaf[] {
  return nodes.flatMap(node => (node.kind === 'leaf' ? [node] : indicatorLeaves(node.children)));
}

/** 全部分类的编码，默认全部展开时用 */
export function indicatorGroupCodes(nodes: readonly IndicatorTreeNode[]): string[] {
  return nodes.flatMap(node => (node.kind === 'group' ? [node.code, ...indicatorGroupCodes(node.children)] : []));
}

/**
 * 同一个指标可能挂在几个分类下（旧页面的处理）：只保留第一次出现的，去重后没有指标的分类不显示
 */
export function dedupeIndicators(nodes: readonly IndicatorTreeNode[]): IndicatorTreeNode[] {
  const seen = new Set<string>();
  const walk = (list: readonly IndicatorTreeNode[]): IndicatorTreeNode[] =>
    list.flatMap((node): IndicatorTreeNode[] => {
      if (node.kind === 'leaf') {
        if (seen.has(node.code)) {
          return [];
        }
        seen.add(node.code);
        return [node];
      }
      const children = walk(node.children);
      return children.length > 0 ? [{ ...node, children }] : [];
    });
  return walk(nodes);
}

/** 按名称搜索：保留名称包含关键字的指标和它们的分类；关键字为空时原样返回 */
export function filterIndicatorTree(nodes: readonly IndicatorTreeNode[], keyword: string): readonly IndicatorTreeNode[] {
  const text = keyword.trim();
  if (text === '') {
    return nodes;
  }
  const walk = (list: readonly IndicatorTreeNode[]): IndicatorTreeNode[] =>
    list.flatMap((node): IndicatorTreeNode[] => {
      if (node.kind === 'leaf') {
        return node.name.includes(text) ? [node] : [];
      }
      const children = walk(node.children);
      return children.length > 0 ? [{ ...node, children }] : [];
    });
  return walk(nodes);
}
