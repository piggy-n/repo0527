import { modelIdOfKey } from '@/features/scene-models/layer-panel';

// 图层列表（下段）的纯函数（ADR 0157、0161）：二维资源和三维模型平铺成一个列表，从上到下就是叠放；工具栏的移动、
// 移出后选中哪一行、上下方向键换行、筛选时的移动、模型层的位置

const isModelKey = (key: string) => modelIdOfKey(key) !== null;

/**
 * 面的有效不透明度（图层透明度 × 填充色里最大的不透明度）不低于它时，画在模型上面就算把模型盖住，行上提示"盖住模型"
 * （ADR 0161）：0.8 时透过去的不到两成，模型基本看不出来
 */
export const COVER_OPACITY = 0.8;

/** 工具栏、右键菜单里的移动 */
export type MoveAction = 'move-up' | 'move-down' | 'move-top' | 'move-bottom';

/** 在列表（筛选时是看得见的行）里移动到的位置；已经到头、不在列表里时为 null */
export function moveIndex(keys: readonly string[], key: string, action: MoveAction): number | null {
  const index = keys.indexOf(key);
  if (index === -1) {
    return null;
  }
  const to = { 'move-up': index - 1, 'move-down': index + 1, 'move-top': 0, 'move-bottom': keys.length - 1 }[action];
  return to < 0 || to >= keys.length || to === index ? null : to;
}

/**
 * 移出一些行以后选中哪一行（用户 2026-11-13：选中相邻的）：选中的没被移出时不变；被移出时选中原来在它后面的第一行，
 * 后面没有了选前面的；都移出了为 null。keys 是移出前全部的行
 */
export function selectionAfterRemoval(
  keys: readonly string[],
  removed: ReadonlySet<string>,
  selected: string | null
): string | null {
  if (selected === null || !removed.has(selected)) {
    return selected;
  }
  const index = keys.indexOf(selected);
  const after = keys.slice(index + 1).find(key => !removed.has(key));
  return after ?? keys.slice(0, Math.max(0, index)).findLast(key => !removed.has(key)) ?? null;
}

/** 上下方向键换到的行：在看得见的行里，到头时不动 */
export function steppedKey(keys: readonly string[], key: string, delta: number): string {
  const index = keys.indexOf(key);
  return keys[Math.min(keys.length - 1, Math.max(0, index + delta))] ?? key;
}

/**
 * 平铺的图层（ADR 0161、0167）：资源之间的先后按资源的拥有者，模型之间按模型的拥有者，两者怎样穿插按上次的顺序（记在偏好里）。
 * 不是用户加入、自己出现的（恢复的记录、晚到的目录）接在最后，先模型后资源，各按拥有者的先后；用户加入的由 add 直接放在
 * 最上面，不经过这里。上次的顺序里还没到的跳过。和上次一样时返回上次的数组
 */
export function mergedOrder(
  previous: readonly string[],
  layers: readonly string[],
  models: readonly string[]
): readonly string[] {
  const present = new Set([...layers, ...models]);
  const kept = previous.filter(key => present.has(key));
  const known = new Set(kept);
  const slots = [...kept, ...models.filter(key => !known.has(key)), ...layers.filter(key => !known.has(key))];
  // 位置按穿插，内容按各自拥有者的先后
  let layer = 0;
  let model = 0;
  const merged = slots.map(key => (isModelKey(key) ? (models[model++] ?? key) : (layers[layer++] ?? key)));
  const same = merged.length === previous.length && merged.every((key, index) => key === previous[index]);
  return same ? previous : merged;
}

/**
 * 操作后要记下的顺序（ADR 0167）：next 是这次操作后看得见的行，上次记下的顺序里还没到的（目录、清单没到）留在原来的
 * 位置，跟在它前面最近的那个还在的行后面；dropped 是这次移出的，不再留着
 */
export function withPending(
  next: readonly string[],
  previous: readonly string[],
  present: ReadonlySet<string>,
  dropped: ReadonlySet<string> = new Set()
): readonly string[] {
  const pending = previous.filter(key => !present.has(key) && !dropped.has(key) && !next.includes(key));
  if (pending.length === 0) {
    return next;
  }
  // 按上次的先后逐个放回：前面已经放回的也算锚点，连着几个还没到的保持原来的先后
  const result = [...next];
  for (const key of pending) {
    const index = previous.indexOf(key);
    const anchor = previous.slice(0, index).findLast(item => result.includes(item));
    result.splice(anchor === undefined ? 0 : result.indexOf(anchor) + 1, 0, key);
  }
  return result;
}

/** 画在模型上面的资源的键（ADR 0161）：排在最上面那个模型上面的，从上到下；没有模型时没有 */
export function layersAboveModels(keys: readonly string[]): readonly string[] {
  const top = keys.findIndex(isModelKey);
  return top === -1 ? [] : keys.slice(0, top);
}

/**
 * 按看得见的行移动（ADR 0161，筛选时也能排序）：把 key 挪到看得见的第 to 位。往上挪放到越过的那一行的正上方，往下挪放到
 * 越过的那一行的正下方，看不见的行原地不动；没有筛选时看得见的就是全部。位置不变时为 null；key 看不见、to 越界时抛错
 */
export function movedOrder(
  keys: readonly string[],
  visible: readonly string[],
  key: string,
  to: number
): readonly string[] | null {
  const from = visible.indexOf(key);
  if (from === -1) {
    throw new Error(`看得见的行里没有 ${key}`);
  }
  if (!(Number.isInteger(to) && to >= 0 && to < visible.length)) {
    throw new RangeError(`位置应在 0～${visible.length - 1} 之间，收到 ${to}`);
  }
  if (from === to) {
    return null;
  }
  const rest = visible.toSpliced(from, 1);
  const others = keys.filter(item => item !== key);
  if (to < from) {
    const anchor = others.indexOf(rest[to] ?? '');
    return others.toSpliced(anchor, 0, key);
  }
  const anchor = others.indexOf(rest[to - 1] ?? '');
  return others.toSpliced(anchor + 1, 0, key);
}
