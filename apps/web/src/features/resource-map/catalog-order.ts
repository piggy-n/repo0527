import { z } from 'zod';

/**
 * 目录的展示顺序（ADR 0053 第 6 节）：按父节点记录子节点的键（分类的 id、资源的 code），只管面板上的树怎么排，
 * 不改目录本身、资源的 index（按值配色的默认颜色）和叠放顺序。顶层的父节点是 CATALOG_ROOT
 */
export type CatalogOrder = Readonly<Record<string, readonly string[]>>;

export const CATALOG_ROOT = '';

export const EMPTY_CATALOG_ORDER: CatalogOrder = Object.freeze({});

/**
 * 按记录的顺序排列子节点：记录里仍存在的按记录的顺序在前，记录里没有的（目录里新出现的）按原来的顺序排在后面，
 * 已经不在目录里的键忽略
 */
export function orderedChildren<T>(children: readonly T[], keyOf: (child: T) => string, stored?: readonly string[]): T[] {
  if (!stored || stored.length === 0) {
    return [...children];
  }
  const byKey = new Map(children.map(child => [keyOf(child), child]));
  const listed = stored.flatMap(key => {
    const child = byKey.get(key);
    return child === undefined ? [] : [child];
  });
  const rest = children.filter(child => !stored.includes(keyOf(child)));
  return [...listed, ...rest];
}

/**
 * 把某个父节点下的第 from 个子节点移到第 to 位：keys 是面板上这个父节点下的全部子节点，按当前的展示顺序。
 * 只记这个父节点的新顺序；位置越界、键重复时抛错，位置不变时原样返回
 */
export function moveInCatalog(
  order: CatalogOrder,
  parentId: string,
  keys: readonly string[],
  from: number,
  to: number
): CatalogOrder {
  if (new Set(keys).size !== keys.length) {
    throw new Error(`${parentId || '顶层'}下的子节点有重复的键`);
  }
  for (const index of [from, to]) {
    if (!(Number.isInteger(index) && index >= 0 && index < keys.length)) {
      throw new RangeError(`位置应在 0～${keys.length - 1} 之间，收到 ${index}`);
    }
  }
  if (from === to) {
    return order;
  }
  const moving = keys[from];
  if (moving === undefined) {
    return order;
  }
  return { ...order, [parentId]: keys.toSpliced(from, 1).toSpliced(to, 0, moving) };
}

/** 存下的目录顺序（ADR 0042）：每个父节点下的键不能重复 */
export const storedCatalogOrderSchema = z.record(
  z.string(),
  z.array(z.string()).refine(keys => new Set(keys).size === keys.length, { message: '同一个父节点下有重复的键' })
);
