import type { NavGridData, NavOptions } from './nav-data';

/** 一个叶节点瓦片：b3dm 的内容和内容坐标 → 根节点局部系的矩阵 */
export interface NavTile {
  readonly buffer: ArrayBuffer;
  readonly toLocal: Float64Array;
}

/** 导航网格 Worker 的协议（ADR 0085 第 3 节）：瓦片转移进去，网格的类型化数组转移回来 */
export interface NavWorkerProtocol {
  readonly build: {
    readonly request: { readonly tiles: readonly NavTile[]; readonly options: Partial<NavOptions> };
    readonly response: NavGridData;
  };
}
