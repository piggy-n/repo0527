/**
 * 隔离一份泼溅时，最多等别的泼溅放掉数据这么久（毫秒）：库的冷却 2 秒加余量。库停止细化（LOD 的 Worker 失败）的调度器
 * 不再选区域、也不再放数据，不能一直等（ADR 0156 R.5）
 */
export const ISOLATION_RELEASE_TIMEOUT = 5000;

export interface SplatShareInput {
  /** 泼溅的总预算（高斯个数） */
  readonly total: number;
  readonly ids: readonly string[];
  /** 隔离的那份；没有隔离（或者抬高的是瓦片集）时 null */
  readonly isolated: string | null;
  /** 还占着数据的 */
  readonly holding: ReadonlySet<string>;
  /** 隔离开始以后过了多少毫秒 */
  readonly waited: number;
}

export interface SplatShares {
  readonly budgets: ReadonlyMap<string, number>;
  /** 还在等别的放掉数据：渲染器接着画帧 */
  readonly waiting: boolean;
}

/**
 * 各份泼溅的预算：平时按份平分。隔离一份时别的不画、只留 1；它们都放掉数据以后隔离的那份拿全部，之前仍按平分。
 * 等了 ISOLATION_RELEASE_TIMEOUT 还有没放掉的就不再等：隔离的那份拿全部，这时总数可能超出没放掉的那些
 */
export function splatShares({ total, ids, isolated, holding, waited }: SplatShareInput): SplatShares {
  const share = Math.max(1, Math.floor(total / Math.max(1, ids.length)));
  if (isolated === null || !ids.includes(isolated)) {
    return { budgets: new Map(ids.map(id => [id, share])), waiting: false };
  }
  const waiting = waited < ISOLATION_RELEASE_TIMEOUT && ids.some(id => id !== isolated && holding.has(id));
  const alone = waiting ? share : total;
  return { budgets: new Map(ids.map(id => [id, id === isolated ? alone : 1])), waiting };
}
