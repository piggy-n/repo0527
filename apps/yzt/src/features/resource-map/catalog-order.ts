import type { CatalogNode } from './catalog';

// 目录树的顺序就是地图的叠放顺序（2026-10-30，ADR 0118，取代 ADR 0053 第 6 节、ADR 0096 的两份顺序）：
// 资源图层的 order 是唯一的顺序，树上同一个父节点下的子节点按它们在 order 里最靠前的资源排，"已选择图层"、图例和地图按 order 排

/** 目录树顶层的父节点 */
export const CATALOG_ROOT = '';

/** 目录树里一次同级调整：把 parentId 下的第 from 个子节点移到第 to 位；keys 是这个父节点下的子节点（分类的 id、资源的 code），按当前的顺序 */
export interface TreeMove {
  readonly parentId: string;
  readonly keys: readonly string[];
  readonly from: number;
  readonly to: number;
}

/**
 * 按给出的键排列子节点：键里有的按键的顺序在前，没有的（如面板上不显示的空分类）按原来的顺序排在后面，
 * 已经不在子节点里的键忽略
 */
export function orderedChildren<T>(children: readonly T[], keyOf: (child: T) => string, keys: readonly string[]): T[] {
  const byKey = new Map(children.map(child => [keyOf(child), child]));
  const listed = keys.flatMap(key => {
    const child = byKey.get(key);
    return child === undefined ? [] : [child];
  });
  const rest = children.filter(child => !keys.includes(keyOf(child)));
  return [...listed, ...rest];
}

// 调整后这个父节点下的键；位置越界、键重复时抛错
function movedKeys({ parentId, keys, from, to }: TreeMove): string[] {
  if (new Set(keys).size !== keys.length) {
    throw new Error(`${parentId || '顶层'}下的子节点有重复的键`);
  }
  for (const index of [from, to]) {
    if (!(Number.isInteger(index) && index >= 0 && index < keys.length)) {
      throw new RangeError(`位置应在 0～${keys.length - 1} 之间，收到 ${index}`);
    }
  }
  const moving = keys[from];
  return moving === undefined ? [...keys] : keys.toSpliced(from, 1).toSpliced(to, 0, moving);
}

/**
 * 按目录树整理的叠放顺序：同一个父节点下的子节点按它们最靠前的资源在 order 里的位置排（一样时保持目录的顺序），
 * 再从上到下列出资源，同一个分类的资源总是连在一起；order 里没有的资源排在同级的最后。
 * 给出 move 时，那个父节点下的子节点按调整后的顺序排，位置越界、键重复时抛错
 */
export function treeOrder(nodes: readonly CatalogNode[], order: readonly string[], move?: TreeMove): string[] {
  const moved = move && { parentId: move.parentId, keys: movedKeys(move) };
  const position = new Map(order.map((code, index) => [code, index]));
  const visit = (children: readonly CatalogNode[], parentId: string): string[] => {
    const items = children.map(child => {
      const codes = child.kind === 'resource' ? [child.code] : visit(child.children, child.id);
      const rank = Math.min(order.length, ...codes.map(code => position.get(code) ?? order.length));
      return { key: child.kind === 'resource' ? child.code : child.id, codes, rank };
    });
    const sorted =
      moved?.parentId === parentId
        ? orderedChildren(items, item => item.key, moved.keys)
        : items.toSorted((a, b) => a.rank - b.rank);
    return sorted.flatMap(item => item.codes);
  };
  return visit(nodes, CATALOG_ROOT);
}
