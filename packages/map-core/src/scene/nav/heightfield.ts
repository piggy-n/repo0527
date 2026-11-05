// 高度场构建（ADR 0085，思路同 Recast 的 heightfield）：三角形按水平网格逐格裁剪，得到每格的实体区间
// [zmin, zmax]，按高度合并；合并后区间的顶面可站立（坡度够缓）、到上方下一个区间的净空不小于身高，就是一层地板。
// 墙体是竖直三角形，会把脚下的地板区间一路并到墙顶，顶面不可站立，于是成了障碍；楼梯每级踏面留下各自高度的地板
import {
  CHUNK,
  COVER_RANGE,
  HEADROOM_OPEN,
  HEADROOM_UNITS,
  HEIGHT_UNITS,
  NAV_DEFAULTS,
  NAV_EMPTY,
  type NavOptions,
  type RawNavGrid
} from './nav-data';

/** 多边形最多的顶点数：三角形被轴对齐直线切过后最多 7 个 */
const MAX_POLY = 12;

// 按 axis（0 是 x，1 是 y）在 value 处把多边形切成两半（Recast 的 dividePoly），返回两半的顶点数
function dividePoly(
  input: Float64Array,
  count: number,
  below: Float64Array,
  above: Float64Array,
  axis: number,
  value: number
): [number, number] {
  let belowCount = 0;
  let aboveCount = 0;
  for (let i = 0, j = count - 1; i < count; j = i, i++) {
    const di = input[i * 3 + axis] - value;
    const dj = input[j * 3 + axis] - value;
    if (dj >= 0 !== di >= 0) {
      const s = dj / (dj - di);
      for (let k = 0; k < 3; k++) {
        const v = input[j * 3 + k] + (input[i * 3 + k] - input[j * 3 + k]) * s;
        below[belowCount * 3 + k] = v;
        above[aboveCount * 3 + k] = v;
      }
      belowCount++;
      aboveCount++;
    }
    for (let k = 0; k < 3; k++) {
      if (di >= 0) {
        above[aboveCount * 3 + k] = input[i * 3 + k];
      }
      if (di <= 0) {
        below[belowCount * 3 + k] = input[i * 3 + k];
      }
    }
    if (di >= 0) {
      aboveCount++;
    }
    if (di <= 0) {
      belowCount++;
    }
  }
  return [belowCount, aboveCount];
}

// 容量翻倍，保留原来的内容
function grow<T extends Float32Array | Uint8Array | Int32Array>(old: T, make: (length: number) => T): T {
  const out = make(old.length * 2);
  out.set(old);
  return out;
}

// 区间池：每格是按高度升序的链表，释放的区间复用
class SpanPool {
  min = new Float32Array(1 << 20);
  max = new Float32Array(1 << 20);
  walk = new Uint8Array(1 << 20);
  next = new Int32Array(1 << 20);
  #size = 0;
  #free = -1;

  alloc(): number {
    if (this.#free !== -1) {
      const index = this.#free;
      this.#free = this.next[index];
      return index;
    }
    if (this.#size === this.min.length) {
      this.min = grow(this.min, length => new Float32Array(length));
      this.max = grow(this.max, length => new Float32Array(length));
      this.walk = grow(this.walk, length => new Uint8Array(length));
      this.next = grow(this.next, length => new Int32Array(length));
    }
    return this.#size++;
  }

  release(index: number): void {
    this.next[index] = this.#free;
    this.#free = index;
  }
}

interface Rasterizer {
  readonly heads: Int32Array;
  readonly pool: SpanPool;
  readonly width: number;
  readonly height: number;
  readonly minX: number;
  readonly minY: number;
  readonly cellSize: number;
  readonly flagMergeThreshold: number;
  readonly minWalkNz: number;
  walkable: boolean;
  // 行、列各用一对缓冲区交替，输入输出不会重叠
  readonly polyA: Float64Array;
  readonly polyB: Float64Array;
  readonly rowPoly: Float64Array;
  readonly colRest: Float64Array;
  readonly cellPoly: Float64Array;
}

// 往某格插入一个区间并与重叠区间合并：顶面取较高者；两个顶面相差不超过阈值时"可站立"取或，否则跟随较高的那个。
// 这样竖墙并进地板后顶面不可站立，而地面上几厘米的收边、门槛不会把地板变成障碍
function addSpan(ctx: Rasterizer, cell: number, spanMin: number, spanMax: number, spanWalk: boolean): void {
  const { heads, pool, flagMergeThreshold } = ctx;
  let min = spanMin;
  let max = spanMax;
  let walk = spanWalk;
  let prev = -1;
  let cur = heads[cell];
  while (cur !== -1) {
    if (pool.min[cur] > max) {
      break;
    }
    if (pool.max[cur] < min) {
      prev = cur;
      cur = pool.next[cur];
      continue;
    }
    const curMax = pool.max[cur];
    if (Math.abs(curMax - max) <= flagMergeThreshold) {
      walk = walk || pool.walk[cur] === 1;
    } else if (curMax > max) {
      walk = pool.walk[cur] === 1;
    }
    min = Math.min(min, pool.min[cur]);
    max = Math.max(max, curMax);
    const next = pool.next[cur];
    pool.release(cur);
    if (prev === -1) {
      heads[cell] = next;
    } else {
      pool.next[prev] = next;
    }
    cur = next;
  }
  const span = pool.alloc();
  pool.min[span] = min;
  pool.max[span] = max;
  pool.walk[span] = walk ? 1 : 0;
  if (prev === -1) {
    pool.next[span] = heads[cell];
    heads[cell] = span;
  } else {
    pool.next[span] = pool.next[prev];
    pool.next[prev] = span;
  }
}

// 一行（y 已定）里逐列切出每格的多边形，记下 z 范围
function rasterizeRow(ctx: Rasterizer, rowCount: number, y: number): void {
  const { rowPoly, cellPoly, minX, cellSize, width } = ctx;
  let rowMinX = rowPoly[0];
  let rowMaxX = rowPoly[0];
  for (let i = 1; i < rowCount; i++) {
    rowMinX = Math.min(rowMinX, rowPoly[i * 3]);
    rowMaxX = Math.max(rowMaxX, rowPoly[i * 3]);
  }
  const x0 = Math.max(0, Math.floor((rowMinX - minX) / cellSize));
  const x1 = Math.min(width - 1, Math.floor((rowMaxX - minX) / cellSize));
  let colIn = rowPoly;
  let colOut = ctx.colRest;
  let colCount = rowCount;
  for (let x = x0; x <= x1 && colCount >= 3; x++) {
    const [cellCount, remain] = dividePoly(colIn, colCount, cellPoly, colOut, 0, minX + (x + 1) * cellSize);
    [colIn, colOut] = [colOut, colIn];
    colCount = remain;
    if (cellCount < 3) {
      continue;
    }
    let zMin = cellPoly[2];
    let zMax = cellPoly[2];
    for (let i = 1; i < cellCount; i++) {
      zMin = Math.min(zMin, cellPoly[i * 3 + 2]);
      zMax = Math.max(zMax, cellPoly[i * 3 + 2]);
    }
    addSpan(ctx, y * width + x, zMin, zMax, ctx.walkable);
  }
}

// 单个三角形：先按行切，再交给 rasterizeRow 按列切（Recast 的 rasterizeTri）
function rasterizeTriangle(ctx: Rasterizer, set: Float32Array, t: number): void {
  const ux = set[t + 3] - set[t];
  const uy = set[t + 4] - set[t + 1];
  const uz = set[t + 5] - set[t + 2];
  const vx = set[t + 6] - set[t];
  const vy = set[t + 7] - set[t + 1];
  const vz = set[t + 8] - set[t + 2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-10) {
    return;
  }
  // 双面材质的法线朝向不可信，按绝对值判坡度
  ctx.walkable = Math.abs(nz) / length >= ctx.minWalkNz;
  const { minY, cellSize, height, rowPoly } = ctx;
  const y0 = Math.max(0, Math.floor((Math.min(set[t + 1], set[t + 4], set[t + 7]) - minY) / cellSize));
  const y1 = Math.min(height - 1, Math.floor((Math.max(set[t + 1], set[t + 4], set[t + 7]) - minY) / cellSize));
  let rowIn = ctx.polyA;
  let rowOut = ctx.polyB;
  for (let k = 0; k < 9; k++) {
    rowIn[k] = set[t + k];
  }
  let inCount = 3;
  for (let y = y0; y <= y1 && inCount >= 3; y++) {
    const [rowCount, restCount] = dividePoly(rowIn, inCount, rowPoly, rowOut, 1, minY + (y + 1) * cellSize);
    [rowIn, rowOut] = [rowOut, rowIn];
    inCount = restCount;
    if (rowCount >= 3) {
      rasterizeRow(ctx, rowCount, y);
    }
  }
}

// 一格里所有可站立、净空够高的顶面，编码后写进 levels（净空写进 rooms），返回层数
function collectCellFloors(
  ctx: Rasterizer,
  cell: number,
  agentHeight: number,
  levels: Int16Array,
  rooms: Uint8Array
): number {
  const { heads, pool } = ctx;
  let count = 0;
  for (let s = heads[cell]; s !== -1 && count < levels.length; s = pool.next[s]) {
    const next = pool.next[s];
    const clearance = next === -1 ? Infinity : pool.min[next] - pool.max[s];
    if (pool.walk[s] && clearance >= agentHeight) {
      const covered = clearance <= COVER_RANGE ? 1 : 0;
      rooms[count] =
        clearance === Infinity ? HEADROOM_OPEN : Math.min(HEADROOM_OPEN - 1, Math.floor(clearance * HEADROOM_UNITS));
      levels[count++] = Math.round(pool.max[s] * HEIGHT_UNITS) * 2 + covered;
    }
  }
  return count;
}

// 每格取出可站立的顶面，写成稀疏分块的 Int16（编码见 NAV_EMPTY）
function extractFloors(ctx: Rasterizer, agentHeight: number, maxLevels: number): RawNavGrid {
  const { width, height, minX, minY, cellSize } = ctx;
  const chunksX = Math.ceil(width / CHUNK);
  const chunksY = Math.ceil(height / CHUNK);
  const chunkIndex = new Int32Array(chunksX * chunksY).fill(-1);
  const blockSize = CHUNK * CHUNK * maxLevels;
  const blocks: Int16Array[] = [];
  const roomBlocks: Uint8Array[] = [];
  let floorCells = 0;
  let droppedLevels = 0;
  const levels = new Int16Array(16);
  const rooms = new Uint8Array(16);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const count = collectCellFloors(ctx, y * width + x, agentHeight, levels, rooms);
      if (!count) {
        continue;
      }
      const chunk = Math.floor(y / CHUNK) * chunksX + Math.floor(x / CHUNK);
      if (chunkIndex[chunk] === -1) {
        chunkIndex[chunk] = blocks.length;
        blocks.push(new Int16Array(blockSize).fill(NAV_EMPTY));
        roomBlocks.push(new Uint8Array(blockSize));
      }
      floorCells++;
      droppedLevels += Math.max(0, count - maxLevels);
      const base = ((y % CHUNK) * CHUNK + (x % CHUNK)) * maxLevels;
      const kept = Math.min(count, maxLevels);
      blocks[chunkIndex[chunk]].set(levels.subarray(0, kept), base);
      roomBlocks[chunkIndex[chunk]].set(rooms.subarray(0, kept), base);
    }
  }
  const data = new Int16Array(blocks.length * blockSize);
  const headroom = new Uint8Array(blocks.length * blockSize);
  blocks.forEach((block, i) => data.set(block, i * blockSize));
  roomBlocks.forEach((block, i) => headroom.set(block, i * blockSize));
  return {
    meta: { minX, minY, cellSize, width, height, chunksX, chunksY, maxLevels, floorCells, droppedLevels },
    chunkIndex,
    data,
    headroom
  };
}

/** 由若干组三角形（parseB3dmTriangles 的结果）构建导航高度场 */
export function buildNavGrid(triangleSets: readonly Float32Array[], options: Partial<NavOptions> = {}): RawNavGrid {
  const { cellSize, agentHeight, maxSlopeDeg, flagMergeThreshold, maxLevels } = { ...NAV_DEFAULTS, ...options };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const set of triangleSets) {
    for (let i = 0; i < set.length; i += 3) {
      minX = Math.min(minX, set[i]);
      maxX = Math.max(maxX, set[i]);
      minY = Math.min(minY, set[i + 1]);
      maxY = Math.max(maxY, set[i + 1]);
    }
  }
  if (!Number.isFinite(minX)) {
    throw new Error('模型没有可用的三角形');
  }
  const width = Math.ceil((maxX - minX) / cellSize) + 1;
  const height = Math.ceil((maxY - minY) / cellSize) + 1;
  const ctx: Rasterizer = {
    heads: new Int32Array(width * height).fill(-1),
    pool: new SpanPool(),
    width,
    height,
    minX,
    minY,
    cellSize,
    flagMergeThreshold,
    minWalkNz: Math.cos((maxSlopeDeg * Math.PI) / 180),
    walkable: false,
    polyA: new Float64Array(3 * MAX_POLY),
    polyB: new Float64Array(3 * MAX_POLY),
    rowPoly: new Float64Array(3 * MAX_POLY),
    colRest: new Float64Array(3 * MAX_POLY),
    cellPoly: new Float64Array(3 * MAX_POLY)
  };
  for (const set of triangleSets) {
    for (let t = 0; t < set.length; t += 9) {
      rasterizeTriangle(ctx, set, t);
    }
  }
  return extractFloors(ctx, agentHeight, maxLevels);
}
