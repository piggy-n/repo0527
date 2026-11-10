import type { Mesh } from './ply.ts';

// 碰撞网格按 xy 方格采样成多层的高度：每个方格中心往下看到的所有表面的高度（地面、台阶、桌面、地下的楼板）。
// 方格要细：1 米的方格在坡上一格里高度差几十厘米，取"脚下最近的地面"会偏高（楚王山1号的轨迹核对因此不对）

export interface FloorGrid {
  readonly cellSize: number;
  readonly minX: number;
  readonly minY: number;
  readonly columns: number;
  readonly rows: number;
  /** 第 i 个方格的高度是 heights 的 [offsets[i], offsets[i + 1])，从低到高 */
  readonly offsets: Uint32Array;
  readonly heights: Float32Array;
  readonly triangleCount: number;
}

export interface FloorGridBuilder {
  add(mesh: Mesh): void;
  build(): FloorGrid;
}

/** 方格边长（米）：坡度 30° 时，点和方格中心的水平差带来的高度误差不超过约 8 厘米 */
export const DEFAULT_CELL_SIZE = 0.2;

// 法线和竖直方向的夹角超过约 84° 的面（墙）竖直往下看不到，跳过
const MIN_NORMAL_Z = 0.1;
// 同一方格里相差不到 2 厘米的高度算一层
const HEIGHT_MERGE = 0.02;
// 方格的行列编码成一个数做键：行列都在 ±32768 以内（0.2 米的方格是 ±6.5 公里）
const KEY_BASE = 65536;
const KEY_OFFSET = 32768;
const columnOf = (key: number) => Math.floor(key / KEY_BASE) - KEY_OFFSET;
const rowOf = (key: number) => (key % KEY_BASE) - KEY_OFFSET;

/** 可增长的类型化数组：网格有上千万个三角形，普通数组太占内存 */
class Growable<T extends Uint32Array | Float32Array> {
  data: T;
  length = 0;
  readonly create: (size: number) => T;

  constructor(create: (size: number) => T) {
    this.create = create;
    this.data = create(1 << 16);
  }

  push(value: number) {
    if (this.length === this.data.length) {
      const next = this.create(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = value;
  }
}

/** 一次加一个网格文件，读完的文件不必留在内存里 */
export function createFloorGridBuilder(cellSize = DEFAULT_CELL_SIZE): FloorGridBuilder {
  const keys = new Growable((size) => new Uint32Array(size));
  const values = new Growable((size) => new Float32Array(size));
  let triangleCount = 0;

  const push = (column: number, row: number, height: number) => {
    if (Math.abs(column) >= KEY_OFFSET || Math.abs(row) >= KEY_OFFSET) {
      throw new Error(`网格超出范围：方格 (${column}, ${row})，离局部系原点太远`);
    }
    keys.push((column + KEY_OFFSET) * KEY_BASE + (row + KEY_OFFSET));
    values.push(height);
  };

  const addTriangle = (positions: Float32Array, a: number, b: number, c: number) => {
    const x0 = positions[a * 3];
    const y0 = positions[a * 3 + 1];
    const z0 = positions[a * 3 + 2];
    const x1 = positions[b * 3];
    const y1 = positions[b * 3 + 1];
    const z1 = positions[b * 3 + 2];
    const x2 = positions[c * 3];
    const y2 = positions[c * 3 + 1];
    const z2 = positions[c * 3 + 2];
    // 投影到 xy 的面积（带符号）和三维面积之比就是法线的竖直分量
    const area2d = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    const ux = x1 - x0;
    const uy = y1 - y0;
    const uz = z1 - z0;
    const vx = x2 - x0;
    const vy = y2 - y0;
    const vz = z2 - z0;
    const area3d = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, area2d);
    if (area3d === 0 || Math.abs(area2d) / area3d < MIN_NORMAL_Z) {
      return;
    }
    // 方格中心落在三角形里的，按重心坐标插值出中心处的高度
    let hit = false;
    const firstColumn = Math.ceil(Math.min(x0, x1, x2) / cellSize - 0.5);
    const lastColumn = Math.floor(Math.max(x0, x1, x2) / cellSize - 0.5);
    const firstRow = Math.ceil(Math.min(y0, y1, y2) / cellSize - 0.5);
    const lastRow = Math.floor(Math.max(y0, y1, y2) / cellSize - 0.5);
    for (let row = firstRow; row <= lastRow; row++) {
      const y = (row + 0.5) * cellSize;
      for (let column = firstColumn; column <= lastColumn; column++) {
        const x = (column + 0.5) * cellSize;
        const w1 = ((x - x0) * (y2 - y0) - (x2 - x0) * (y - y0)) / area2d;
        const w2 = ((x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)) / area2d;
        const w0 = 1 - w1 - w2;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
          push(column, row, w0 * z0 + w1 * z1 + w2 * z2);
          hit = true;
        }
      }
    }
    // 比方格小、盖不住任何中心的三角形，记在重心所在的方格里，免得细碎的地面整片丢掉
    if (!hit) {
      const x = (x0 + x1 + x2) / 3;
      const y = (y0 + y1 + y2) / 3;
      push(Math.floor(x / cellSize), Math.floor(y / cellSize), (z0 + z1 + z2) / 3);
    }
  };

  return {
    add({ positions, triangles }) {
      for (let t = 0; t + 2 < triangles.length; t += 3) {
        triangleCount++;
        addTriangle(positions, triangles[t], triangles[t + 1], triangles[t + 2]);
      }
    },
    build() {
      let column0 = Infinity;
      let row0 = Infinity;
      let column1 = -Infinity;
      let row1 = -Infinity;
      for (let i = 0; i < keys.length; i++) {
        const key = keys.data[i];
        column0 = Math.min(column0, columnOf(key));
        row0 = Math.min(row0, rowOf(key));
        column1 = Math.max(column1, columnOf(key));
        row1 = Math.max(row1, rowOf(key));
      }
      if (keys.length === 0) {
        return {
          cellSize,
          minX: 0,
          minY: 0,
          columns: 0,
          rows: 0,
          offsets: new Uint32Array(1),
          heights: new Float32Array(0),
          triangleCount
        };
      }
      const columns = column1 - column0 + 1;
      const rows = row1 - row0 + 1;
      const cellOf = (key: number) => (rowOf(key) - row0) * columns + (columnOf(key) - column0);

      // 计数排序：先数每个方格有几个高度，再按方格放好
      const starts = new Uint32Array(columns * rows + 1);
      for (let i = 0; i < keys.length; i++) {
        const cell = cellOf(keys.data[i]) + 1;
        starts[cell]++;
      }
      for (let cell = 1; cell < starts.length; cell++) {
        starts[cell] += starts[cell - 1];
      }
      const cursor = starts.slice(0, -1);
      const sorted = new Float32Array(keys.length);
      for (let i = 0; i < keys.length; i++) {
        const cell = cellOf(keys.data[i]);
        sorted[cursor[cell]++] = values.data[i];
      }

      // 每个方格里从低到高排好，相近的合并
      const offsets = new Uint32Array(columns * rows + 1);
      const heights = new Float32Array(keys.length);
      let length = 0;
      for (let cell = 0; cell < columns * rows; cell++) {
        const layers = sorted.subarray(starts[cell], starts[cell + 1]).toSorted();
        let last = -Infinity;
        for (const height of layers) {
          if (height - last >= HEIGHT_MERGE) {
            heights[length++] = height;
            last = height;
          }
        }
        offsets[cell + 1] = length;
      }
      return {
        cellSize,
        minX: column0 * cellSize,
        minY: row0 * cellSize,
        columns,
        rows,
        offsets,
        heights: heights.slice(0, length),
        triangleCount
      };
    }
  };
}

/** 一次读完几个网格；网格多、文件大时用 createFloorGridBuilder 逐个加 */
export function buildFloorGrid(meshes: readonly Mesh[], cellSize = DEFAULT_CELL_SIZE): FloorGrid {
  const builder = createFloorGridBuilder(cellSize);
  for (const mesh of meshes) {
    builder.add(mesh);
  }
  return builder.build();
}

/** (x, y) 所在方格的序号，网格外是 -1 */
export function cellAt(grid: FloorGrid, x: number, y: number): number {
  const column = Math.floor((x - grid.minX) / grid.cellSize);
  const row = Math.floor((y - grid.minY) / grid.cellSize);
  if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) {
    return -1;
  }
  return row * grid.columns + column;
}

/** (x, y) 处的各层高度，从低到高；没有时是空的 */
export function floorsAt(grid: FloorGrid, x: number, y: number): Float32Array {
  const cell = cellAt(grid, x, y);
  return cell < 0 ? new Float32Array(0) : grid.heights.subarray(grid.offsets[cell], grid.offsets[cell + 1]);
}

/** 脚下最近的表面：不高于 z 的最高一层，没有时返回 undefined */
export function floorBelow(grid: FloorGrid, x: number, y: number, z: number): number | undefined {
  let below: number | undefined;
  for (const height of floorsAt(grid, x, y)) {
    if (height > z) {
      break;
    }
    below = height;
  }
  return below;
}

/** 所有表面的最低、最高高度 */
export function heightExtent(grid: FloorGrid): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const height of grid.heights) {
    min = Math.min(min, height);
    max = Math.max(max, height);
  }
  return { min, max };
}
