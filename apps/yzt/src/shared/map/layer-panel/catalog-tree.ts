import type { IconName } from '../../icons/SvgIcon';

// 资源目录的节点（ADR 0157）：各 feature 把自己的目录推导成这种通用的节点，页面拼在一起交给目录树；键带种类前缀，互不冲突

/** 能加入当前地图的一项：资源、模型 */
export interface CatalogLeaf {
  readonly kind: 'leaf';
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
  /** 名称后面的补充，如模型的类型 */
  readonly note?: string;
  /** 已加入当前地图 */
  readonly added: boolean;
}

/** 分类：可以展开、收起，操作作用于下面全部的项 */
export interface CatalogBranch {
  readonly kind: 'branch';
  readonly key: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly children: readonly CatalogNode[];
}

export type CatalogNode = CatalogLeaf | CatalogBranch;

/** 节点下面全部的项，按目录的先后；项自己就是它 */
export function leavesOf(node: CatalogNode): CatalogLeaf[] {
  return node.kind === 'leaf' ? [node] : node.children.flatMap(leavesOf);
}

/** 显示着的节点的键，按目录的先后：收起的分类下面的不算；搜索时全部展开 */
export function visibleKeys(
  nodes: readonly CatalogNode[],
  expanded: ReadonlySet<string>,
  searching: boolean
): string[] {
  return nodes.flatMap(node =>
    node.kind === 'branch' && (searching || expanded.has(node.key))
      ? [node.key, ...visibleKeys(node.children, expanded, searching)]
      : [node.key]
  );
}

/** 全部节点的键，不管展开没有 */
export function allKeys(nodes: readonly CatalogNode[]): string[] {
  return nodes.flatMap(node => (node.kind === 'branch' ? [node.key, ...allKeys(node.children)] : [node.key]));
}

/** 全部分类的键：全部展开时用 */
export function branchKeys(nodes: readonly CatalogNode[]): string[] {
  return nodes.flatMap(node => (node.kind === 'branch' ? [node.key, ...branchKeys(node.children)] : []));
}

/** 按键找节点；没有时为 null */
export function findCatalogNode(nodes: readonly CatalogNode[], key: string): CatalogNode | null {
  for (const node of nodes) {
    if (node.key === key) {
      return node;
    }
    const found = node.kind === 'branch' ? findCatalogNode(node.children, key) : null;
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * 默认展开的分类：含有已加入的项的分类，进入页面时当前地图里的资源在目录里看得见；
 * 一项也没有加入时展开全部（ADR 0094）
 */
export function expandedByDefault(nodes: readonly CatalogNode[]): Set<string> {
  const anyAdded = nodes.some(node => leavesOf(node).some(leaf => leaf.added));
  const walk = (list: readonly CatalogNode[]): string[] =>
    list.flatMap(node =>
      node.kind === 'branch' && (!anyAdded || leavesOf(node).some(leaf => leaf.added))
        ? [node.key, ...walk(node.children)]
        : []
    );
  return new Set(walk(nodes));
}

/** 选中的节点合起来能加入、能移出的项 */
export interface CatalogCover {
  /** 还没加入的项的键，按目录的先后 */
  readonly add: readonly string[];
  /** 已加入的项的键，按目录的先后 */
  readonly remove: readonly string[];
}

/**
 * 这些节点（分类算它下面全部的项）合起来能加入、能移出的项，去重，按目录的先后；
 * 已加入的不再算进加入，没加入的不算进移出（用户 2026-11-14：多选时不重复提示）。不在目录里的键忽略
 */
export function catalogCover(nodes: readonly CatalogNode[], keys: Iterable<string>): CatalogCover {
  const chosen = new Set<string>();
  for (const key of keys) {
    const node = findCatalogNode(nodes, key);
    for (const leaf of node ? leavesOf(node) : []) {
      chosen.add(leaf.key);
    }
  }
  const leaves = nodes.flatMap(leavesOf).filter(leaf => chosen.has(leaf.key));
  return {
    add: leaves.filter(leaf => !leaf.added).map(leaf => leaf.key),
    remove: leaves.filter(leaf => leaf.added).map(leaf => leaf.key)
  };
}
