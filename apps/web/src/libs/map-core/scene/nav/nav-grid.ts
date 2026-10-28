import {
  CHUNK,
  HEADROOM_OPEN,
  HEADROOM_UNITS,
  HEIGHT_UNITS,
  NAV_DEFAULTS,
  NAV_EMPTY,
  type NavMeta,
  type RawNavGrid
} from './nav-data';

/** 导航网格上的一点：局部系的平面坐标和脚下的地板高度（米） */
export interface NavPoint {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
}

/** 构造 NavGrid 的数据；算区域之前没有 labels，这时一律当可走 */
export interface NavGridSource extends RawNavGrid {
  readonly labels?: Uint16Array;
  readonly sizes?: Uint32Array;
  readonly agentRadius?: number;
  readonly stepHeight?: number;
}

const NEIGHBORS8: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
];

// A* 用的最小堆（按 f 值出堆）
class MinHeap {
  readonly #items: number[] = [];
  readonly #keys: number[] = [];

  get size(): number {
    return this.#items.length;
  }

  push(item: number, key: number): void {
    const items = this.#items;
    const keys = this.#keys;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) {
        break;
      }
      items[i] = items[parent];
      keys[i] = keys[parent];
      i = parent;
    }
    items[i] = item;
    keys[i] = key;
  }

  pop(): number | undefined {
    const items = this.#items;
    const keys = this.#keys;
    const top = items[0];
    const lastItem = items.pop();
    const lastKey = keys.pop();
    if (items.length > 0 && lastItem !== undefined && lastKey !== undefined) {
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        if (left >= items.length) {
          break;
        }
        const child = left + 1 < items.length && keys[left + 1] < keys[left] ? left + 1 : left;
        if (keys[child] >= lastKey) {
          break;
        }
        items[i] = items[child];
        keys[i] = keys[child];
        i = child;
      }
      items[i] = lastItem;
      keys[i] = lastKey;
    }
    return top;
  }
}

/**
 * 导航网格的查询（ADR 0085）。节点 = 某一格的某一层地板，编号就是它在 data 里的下标。
 * labels 是预先算好的"人能站住的节点"及其步行区域：行走碰撞、寻路、点击移动的可达判断都查它，
 * 寻路找到的路一定走得通，不会被点到站台下的轨行区、电梯井这类进去就出不来的地方
 */
export class NavGrid {
  readonly meta: NavMeta;
  readonly chunkIndex: Int32Array;
  readonly data: Int16Array;
  readonly headroom: Uint8Array;
  readonly labels: Uint16Array | null;
  readonly sizes: Uint32Array | null;
  readonly agentRadius: number;
  readonly stepHeight: number;
  /** 每块的节点数 */
  readonly blockSize: number;
  /** 块号 → 分块号：节点编号反解格子坐标时用 */
  readonly blockChunks: Int32Array;
  // 逐帧查询复用的临时数组和对象，只在单个查询内部使用
  readonly #floors: number[] = [];
  readonly #covered: boolean[] = [];
  readonly #cell = { cx: 0, cy: 0, level: 0 };

  constructor(source: NavGridSource) {
    this.meta = source.meta;
    this.chunkIndex = source.chunkIndex;
    this.data = source.data;
    this.headroom = source.headroom;
    this.labels = source.labels ?? null;
    this.sizes = source.sizes ?? null;
    this.agentRadius = source.agentRadius ?? NAV_DEFAULTS.agentRadius;
    this.stepHeight = source.stepHeight ?? NAV_DEFAULTS.stepHeight;
    this.blockSize = CHUNK * CHUNK * source.meta.maxLevels;
    this.blockChunks = new Int32Array(Math.max(1, source.data.length / this.blockSize));
    source.chunkIndex.forEach((block, chunk) => {
      if (block !== -1) {
        this.blockChunks[block] = chunk;
      }
    });
  }

  /** (x, y) 所在的格子，网格外为 null */
  cellOf(x: number, y: number): [number, number] | null {
    const { minX, minY, cellSize, width, height } = this.meta;
    const cx = Math.floor((x - minX) / cellSize);
    const cy = Math.floor((y - minY) / cellSize);
    return cx < 0 || cy < 0 || cx >= width || cy >= height ? null : [cx, cy];
  }

  cellCenter(cx: number, cy: number): [number, number] {
    const { minX, minY, cellSize } = this.meta;
    return [minX + (cx + 0.5) * cellSize, minY + (cy + 0.5) * cellSize];
  }

  /** 某格第一层地板的节点编号；网格外或所在分块是空的返回 -1 */
  cellBase(cx: number, cy: number): number {
    const { chunksX, maxLevels, width, height } = this.meta;
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) {
      return -1;
    }
    const block = this.chunkIndex[Math.floor(cy / CHUNK) * chunksX + Math.floor(cx / CHUNK)];
    return block === -1 ? -1 : block * this.blockSize + ((cy % CHUNK) * CHUNK + (cx % CHUNK)) * maxLevels;
  }

  /** 节点编号 → 格子与层号；返回复用的对象，调用方立即读走 */
  decode(index: number): Readonly<{ cx: number; cy: number; level: number }> {
    const { maxLevels, chunksX } = this.meta;
    const block = Math.floor(index / this.blockSize);
    const local = index - block * this.blockSize;
    const level = local % maxLevels;
    const cellLocal = (local - level) / maxLevels;
    const chunk = this.blockChunks[block];
    this.#cell.cx = (chunk % chunksX) * CHUNK + (cellLocal % CHUNK);
    this.#cell.cy = Math.floor(chunk / chunksX) * CHUNK + Math.floor(cellLocal / CHUNK);
    this.#cell.level = level;
    return this.#cell;
  }

  nodeFloor(index: number): number {
    return (this.data[index] >> 1) / HEIGHT_UNITS;
  }

  /** 节点的地板头顶有遮盖（室内） */
  nodeCovered(index: number): boolean {
    return (this.data[index] & 1) === 1;
  }

  /** 节点地板到上方顶板的净空（米），上方没有东西为 Infinity */
  nodeHeadroom(index: number): number {
    const value = this.headroom[index];
    return value === HEADROOM_OPEN ? Infinity : value / HEADROOM_UNITS;
  }

  /**
   * (x, y, z) 是不是在空处：这一格有某层地板在它下方，并且它在那层地板的净空之内，上下都离开 margin（米）。
   * 墙、柱子、土里、顶板里、地板下面都不算空处；第三人称相机防穿模用
   */
  isFree(x: number, y: number, z: number, margin = 0): boolean {
    const { minX, minY, cellSize, maxLevels } = this.meta;
    const base = this.cellBase(Math.floor((x - minX) / cellSize), Math.floor((y - minY) / cellSize));
    if (base === -1) {
      return false;
    }
    for (let i = 0; i < maxLevels && this.data[base + i] !== NAV_EMPTY; i++) {
      const floor = this.nodeFloor(base + i);
      if (z >= floor + margin && z <= floor + this.nodeHeadroom(base + i) - margin) {
        return true;
      }
    }
    return false;
  }

  /** (cx, cy) 格里离 z 最近、落差不超过 tolerance 的那层地板的节点编号，没有返回 -1 */
  nodeNear(cx: number, cy: number, z: number, tolerance: number): number {
    const base = this.cellBase(cx, cy);
    if (base === -1) {
      return -1;
    }
    let best = -1;
    for (let i = 0; i < this.meta.maxLevels && this.data[base + i] !== NAV_EMPTY; i++) {
      const diff = Math.abs(this.nodeFloor(base + i) - z);
      if (diff <= tolerance && (best === -1 || diff < Math.abs(this.nodeFloor(best) - z))) {
        best = base + i;
      }
    }
    return best;
  }

  nodeAt(x: number, y: number, floor: number, tolerance = 0.05): number {
    const cell = this.cellOf(x, y);
    return cell ? this.nodeNear(cell[0], cell[1], floor, tolerance) : -1;
  }

  /** 节点所属的区域，0 表示站不住；没算区域时一律当可走 */
  componentOf(index: number): number {
    if (index < 0) {
      return 0;
    }
    return this.labels ? this.labels[index] : 1;
  }

  componentAt(x: number, y: number, floor: number): number {
    return this.componentOf(this.nodeAt(x, y, floor));
  }

  /** 区域的格数 */
  componentSize(id: number): number {
    return this.sizes && id ? this.sizes[id] : 0;
  }

  /** 某格的地板高度（米，升序）；out、covered 由调用方复用，covered[i] 表示第 i 层头顶有遮盖 */
  floorsAtCell(cx: number, cy: number, out: number[] = [], covered: boolean[] | null = null): number[] {
    out.length = 0;
    if (covered) {
      covered.length = 0;
    }
    const base = this.cellBase(cx, cy);
    if (base === -1) {
      return out;
    }
    for (let i = 0; i < this.meta.maxLevels; i++) {
      const value = this.data[base + i];
      if (value === NAV_EMPTY) {
        break;
      }
      out.push((value >> 1) / HEIGHT_UNITS);
      covered?.push((value & 1) === 1);
    }
    return out;
  }

  floorsAt(x: number, y: number, out: number[] = [], covered: boolean[] | null = null): number[] {
    const cell = this.cellOf(x, y);
    if (cell) {
      return this.floorsAtCell(cell[0], cell[1], out, covered);
    }
    out.length = 0;
    if (covered) {
      covered.length = 0;
    }
    return out;
  }

  /** 在 (x, y) 处找离 z 最近、且落在 [z - down, z + up] 内的地板；indoor 为 true 时只认室内地板；没有返回 null */
  findFloor(x: number, y: number, z: number, up: number, down: number, indoor = false): number | null {
    const floors = this.floorsAt(x, y, this.#floors, this.#covered);
    let best: number | null = null;
    floors.forEach((floor, i) => {
      if (
        (!indoor || this.#covered[i]) &&
        floor <= z + up &&
        floor >= z - down &&
        (best === null || Math.abs(floor - z) < Math.abs(best - z))
      ) {
        best = floor;
      }
    });
    return best;
  }

  /** (x, y) 处不高于 z 的最高地板（下落时用） */
  floorBelow(x: number, y: number, z: number): number | null {
    let best: number | null = null;
    for (const floor of this.floorsAt(x, y, this.#floors)) {
      if (floor <= z && (best === null || floor > best)) {
        best = floor;
      }
    }
    return best;
  }

  /** (cx, cy) 格离 ref 一级台阶内的那层地板能不能站人 */
  cellWalkable(cx: number, cy: number, ref: number): boolean {
    return this.componentOf(this.nodeNear(cx, cy, ref, this.stepHeight)) !== 0;
  }

  /** 站在 (x, y) 所在格、离 ref 一级台阶内的那层地板上：返回节点编号，站不住返回 -1 */
  standNode(x: number, y: number, ref: number): number {
    const cell = this.cellOf(x, y);
    if (!cell) {
      return -1;
    }
    const index = this.nodeNear(cell[0], cell[1], ref, this.stepHeight);
    return this.componentOf(index) ? index : -1;
  }

  /**
   * 从 (x0, y0) 站在 floor 上挪到 (x1, y1)（两点相距不超过一格）后脚下的地板高度，走不过去返回 null。
   * 斜着跨进对角格时，线段实际穿过的那个中间格也得能站，不能从墙角缝里挤过去；
   * 只看真正穿过的那一格，路径拉直时的验证和实际行走的结果才能一致
   */
  moveFloor(x0: number, y0: number, floor: number, x1: number, y1: number): number | null {
    const target = this.standNode(x1, y1, floor);
    if (target === -1) {
      return null;
    }
    const from = this.cellOf(x0, y0);
    const to = this.cellOf(x1, y1);
    if (from && to && from[0] !== to[0] && from[1] !== to[1]) {
      const { minX, minY, cellSize } = this.meta;
      const tx = (minX + Math.max(from[0], to[0]) * cellSize - x0) / (x1 - x0);
      const ty = (minY + Math.max(from[1], to[1]) * cellSize - y0) / (y1 - y0);
      // 格子中心之间的连线常常正好穿过格角，先后只差浮点误差；按误差判一侧的话，拉直验证和实际行走会各判一边，
      // 正好穿角就两侧有一侧能站即可
      const corner = Math.abs(tx - ty) < 1e-6;
      const xFirst = (corner || tx < ty) && this.cellWalkable(to[0], from[1], floor);
      const yFirst = (corner || tx >= ty) && this.cellWalkable(from[0], to[1], floor);
      if (!xFirst && !yFirst) {
        return null;
      }
    }
    return this.nodeFloor(target);
  }

  /** (x, y) 周围 radius 内是否全是能站人的地板（出生点要选开阔处，不能贴着墙角） */
  isOpen(x: number, y: number, floor: number, radius: number): boolean {
    const cell = this.cellOf(x, y);
    if (!cell) {
      return false;
    }
    const rings = Math.ceil(radius / this.meta.cellSize);
    for (let dy = -rings; dy <= rings; dy++) {
      for (let dx = -rings; dx <= rings; dx++) {
        if (
          Math.hypot(dx, dy) * this.meta.cellSize <= radius &&
          !this.cellWalkable(cell[0] + dx, cell[1] + dy, floor)
        ) {
          return false;
        }
      }
    }
    return true;
  }

  /** 从某节点往 (dx, dy) 方向相邻格走一步落到的节点（落差在台阶内），没有返回 -1 */
  stepNode(index: number, dx: number, dy: number): number {
    const { cx, cy } = this.decode(index);
    return this.nodeNear(cx + dx, cy + dy, this.nodeFloor(index), this.stepHeight);
  }

  /** (x, y) 附近 maxRadius 内、高度与 z 相差不超过 tolerance 的最近可走节点；component 非 0 时只找这个区域里的 */
  nearestWalkable(
    x: number,
    y: number,
    z: number,
    { maxRadius = 1.5, tolerance = 0.35, component = 0 } = {}
  ): (NavPoint & { readonly index: number }) | null {
    const cell = this.cellOf(x, y);
    if (!cell) {
      return null;
    }
    const rings = Math.ceil(maxRadius / this.meta.cellSize);
    let best: (NavPoint & { readonly index: number }) | null = null;
    let bestDistance = Infinity;
    for (let dy = -rings; dy <= rings; dy++) {
      for (let dx = -rings; dx <= rings; dx++) {
        const index = this.nodeNear(cell[0] + dx, cell[1] + dy, z, tolerance);
        const id = this.componentOf(index);
        const [cx, cy] = this.cellCenter(cell[0] + dx, cell[1] + dy);
        const distance = Math.hypot(cx - x, cy - y);
        if (id && (!component || id === component) && distance <= maxRadius && distance < bestDistance) {
          best = { index, x: cx, y: cy, floor: this.nodeFloor(index) };
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  /**
   * A* 寻路（8 邻接，斜走不切墙角），只在同一区域里走，返回格子中心的点列。maxCost 是允许的最长路径（米）：
   * 估价已超过它就不再搜，点击移动靠它拒绝"看得见但要绕一大圈"的目标，比如站台上点轨道、站厅透过扶梯口点站台
   */
  findPath(start: number, goal: number, { maxCost = Infinity, maxNodes = 200000 } = {}): NavPoint[] | null {
    const component = this.componentOf(start);
    if (!component || component !== this.componentOf(goal)) {
      return null;
    }
    const { cellSize } = this.meta;
    const { cx: gx, cy: gy } = this.decode(goal);
    const heuristic = (index: number) => {
      const { cx, cy } = this.decode(index);
      const dx = Math.abs(cx - gx);
      const dy = Math.abs(cy - gy);
      return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * cellSize;
    };
    const walkable = (index: number) => index !== -1 && this.componentOf(index) === component;
    const cost = new Map<number, number>([[start, 0]]);
    const from = new Map<number, number>();
    const closed = new Set<number>();
    const open = new MinHeap();
    open.push(start, heuristic(start));
    while (open.size > 0) {
      const current = open.pop();
      if (current === undefined) {
        break;
      }
      if (current === goal) {
        return this.#tracePath(from, goal);
      }
      if (closed.has(current)) {
        continue;
      }
      closed.add(current);
      const currentCost = cost.get(current) ?? Infinity;
      if (closed.size > maxNodes || currentCost + heuristic(current) > maxCost) {
        return null;
      }
      const floor = this.nodeFloor(current);
      for (const [dx, dy] of NEIGHBORS8) {
        const next = this.stepNode(current, dx, dy);
        const cutsCorner =
          dx !== 0 &&
          dy !== 0 &&
          (!walkable(this.stepNode(current, dx, 0)) || !walkable(this.stepNode(current, 0, dy)));
        if (!walkable(next) || closed.has(next) || cutsCorner) {
          continue;
        }
        const g = currentCost + (dx && dy ? Math.SQRT2 : 1) * cellSize + Math.abs(this.nodeFloor(next) - floor);
        if (g < (cost.get(next) ?? Infinity)) {
          cost.set(next, g);
          from.set(next, current);
          open.push(next, g + heuristic(next));
        }
      }
    }
    return null;
  }

  #tracePath(from: ReadonlyMap<number, number>, goal: number): NavPoint[] {
    const path: NavPoint[] = [];
    for (let index: number | undefined = goal; index !== undefined; index = from.get(index)) {
      const { cx, cy } = this.decode(index);
      const [x, y] = this.cellCenter(cx, cy);
      path.push({ x, y, floor: this.nodeFloor(index) });
    }
    return path.toReversed();
  }

  /**
   * 沿 a → b 的直线（同一层）累计"站不住"的长度（米）。闸机、栏杆在导航网格里就是一小段站不住的格子
   * （阻挡本身加上两侧身体半径的余量）；中间隔着大片设备、楼板开口的一大片空洞时，这段会很长
   */
  blockedLength(a: NavPoint, b: NavPoint): number {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const samples = Math.max(1, Math.ceil(length / (this.meta.cellSize / 2)));
    let floor = a.floor;
    let blocked = 0;
    for (let i = 1; i <= samples; i++) {
      const node = this.standNode(a.x + ((b.x - a.x) * i) / samples, a.y + ((b.y - a.y) * i) / samples, floor);
      if (node === -1) {
        blocked += length / samples;
      } else {
        floor = this.nodeFloor(node);
      }
    }
    return blocked;
  }

  /** 能否从 a 沿直线走到 b：每半格按行走碰撞（moveFloor）挪一步 */
  walkLine(a: NavPoint, b: NavPoint): boolean {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const samples = Math.max(1, Math.ceil(length / (this.meta.cellSize / 2)));
    let floor: number | null = a.floor;
    let px = a.x;
    let py = a.y;
    for (let i = 1; i <= samples && floor !== null; i++) {
      const x = a.x + ((b.x - a.x) * i) / samples;
      const y = a.y + ((b.y - a.y) * i) / samples;
      floor = this.moveFloor(px, py, floor, x, y);
      px = x;
      py = y;
    }
    return floor !== null && Math.abs(floor - b.floor) <= this.stepHeight;
  }

  /** 把 A* 的锯齿格子路径拉直：从当前点尽量直接连到更远的路径点（先按倍增跳，再逐级收回） */
  smoothPath(path: readonly NavPoint[]): readonly NavPoint[] {
    if (path.length <= 2) {
      return path;
    }
    const result = [path[0]];
    let i = 0;
    while (i < path.length - 1) {
      let j = i + 1;
      let jump = 1;
      while (j + jump < path.length && this.walkLine(path[i], path[j + jump])) {
        j += jump;
        jump *= 2;
      }
      while (jump > 1) {
        jump >>= 1;
        if (j + jump < path.length && this.walkLine(path[i], path[j + jump])) {
          j += jump;
        }
      }
      result.push(path[j]);
      i = j;
    }
    return result;
  }
}
