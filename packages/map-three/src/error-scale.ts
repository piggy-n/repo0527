// 屏幕误差的放宽倍数（ADR 0147 第 5 节）：显存放不下时放宽，规则和理由见 docs/modules/map-three.md"缓存"。
// 这里只有判断，不碰瓦片库和 Three：输入是这一帧的缓存状况和相机

/** 缓存的上限（字节）：到这里不再加载 */
export interface TileBudget {
  readonly hardBytes: number;
}

/** 这一帧的缓存状况，所有显示着的瓦片集合起来 */
export interface CachePressure {
  /** 因为缓存满没能排队的瓦片数 */
  readonly refused: number;
  /** 缓存里的全部字节 */
  readonly cachedBytes: number;
  /** 这一帧在用的瓦片的字节：淘汰不掉的部分 */
  readonly pinnedBytes: number;
  /** 还要加载的瓦片的估计字节 */
  readonly pendingBytes: number;
  /** 这一帧在用的瓦片数（加载好的、没加载好的都算） */
  readonly usedTiles: number;
}

/** 相机：位置（米，任意直角坐标系，前后帧相同）、朝向（单位向量）、离地高度（米） */
export interface BudgetPose {
  readonly position: readonly [number, number, number];
  readonly direction: readonly [number, number, number];
  readonly height: number;
}

/**
 * raising、lowering：倍数变了；evicting：缓存满着但还有旧瓦片，等淘汰后拒绝的瓦片才排得上；
 * settling：等相机停稳后收紧或重新判断。除了 steady 都要再画一帧
 */
export type ScaleMotion = 'raising' | 'lowering' | 'evicting' | 'settling' | 'steady';

// 16.7 毫秒变 5%：60 帧时一秒约 18 倍。太快会放过头，太慢画面要等；放过头的上限是一帧的量
const RATE_PER_FRAME = 1.05;
const FRAME_MS = 1000 / 60;
// 一帧最多按这么久算：卡住的那一帧不能一下子放宽很多
const MAX_ELAPSED_MS = 100;
// 缓存里还有这么多可以淘汰的就不算放不下：等淘汰，不放宽
const EVICTABLE_RATIO = 0.02;
// 估计的总量超过上限这么多时提前放宽，不等真的装满；估得不准的时候也只是少涨或多涨一点，涨到条件消失就停
const PREDICT_RATIO = 1.2;
// 放宽了这么多倍、在用的瓦片数都没变：已经是最粗的一层，再放宽也没有用。真实数据相邻两层的误差差 2～5 倍
const SATURATE_FACTOR = 8;
// 等淘汰时缓存这么久没有变小就不等了：库不会淘汰"淘汰后低于下限"的瓦片，单块瓦片比溢出的额度还大时会一直停在这里
const EVICT_STALL_MS = 1000;
// 需求低于上限的这个比例才收紧：有下限防来回折腾，这条线只是不要贴着上限走。太低的话飞行后收紧到一半就停，比第一次加载粗
const LOWER_RATIO = 0.9;
// 只防数值失控：没有内容的节点总是往下走，再大也至少画出最粗的一层
const MAX_SCALE = 256;
// 相机离开放宽时的位置超过高度的这个比例，或者转过这个角度，才算换了姿态（同 JKQ 的排查）
const RELEASE_DISTANCE_RATIO = 0.25;
const RELEASE_DIRECTION_COS = Math.cos((10 * Math.PI) / 180);
// 贴地时高度接近 0：至少走这么远才算移动
const MIN_RELEASE_METERS = 5;
// 相机这么久没动算停稳
const SETTLE_MS = 500;

function samePose(a: BudgetPose, b: BudgetPose): boolean {
  return a.position.every((value, axis) => value === b.position[axis]) && a.direction.every((value, axis) => value === b.direction[axis]);
}

function movedAway(from: BudgetPose, to: BudgetPose): boolean {
  const distance = Math.hypot(
    to.position[0] - from.position[0],
    to.position[1] - from.position[1],
    to.position[2] - from.position[2]
  );
  if (distance > Math.max(MIN_RELEASE_METERS, RELEASE_DISTANCE_RATIO * Math.abs(from.height))) {
    return true;
  }
  const cos =
    from.direction[0] * to.direction[0] + from.direction[1] * to.direction[1] + from.direction[2] * to.direction[2];
  return cos < RELEASE_DIRECTION_COS;
}

/**
 * 真的放不下才放宽；一放宽就锁在这个姿态：相机不离开，就不再收紧到放不下的倍数以下。这个下限只升不降，所以同一个姿态下一定停下，
 * 不会整级丢掉后又加载回来（Cesium 低于预算就收紧，模拟里就是这样来回折腾）。帧慢时一步放过了头，可以收回到下限。
 * 相机动着的时候只放宽不收紧（每动一下就收紧的话，停下之前要白加载好几次）；这时定的下限只对那一路的画面成立，
 * 停稳后重新判断一次，停着定的不再放开，所以判断的次数是有限的
 */
export class ErrorScale {
  readonly #budget: TileBudget;
  #value = 1;
  // 锁定时的相机；相机离开它就解锁
  #lockedAt: BudgetPose | null = null;
  // 这个姿态下收紧不到这以下：刚放不下的倍数再高一步
  #floor = 1;
  // 下限是相机动着的时候定的：停稳后放开
  #floorWhileMoving = false;
  #lastPose: BudgetPose | null = null;
  // 相机多久没动了；一开始算停稳的：第一次加载时相机本来就没动
  #stillMs = SETTLE_MS;
  #saturated = false;
  // 这一轮放宽的起点：倍数和在用的瓦片数
  #baseValue = 1;
  #baseTiles = 0;
  // 等淘汰：上一帧的缓存大小，缓存没有变小已经多久
  #lastCachedBytes = Number.POSITIVE_INFINITY;
  #evictStalledMs = 0;

  constructor(budget: TileBudget) {
    this.#budget = budget;
  }

  get value(): number {
    return this.#value;
  }

  get locked(): boolean {
    return this.#lockedAt !== null;
  }

  get saturated(): boolean {
    return this.#saturated;
  }

  /** 内容变了（瓦片集增删、显隐、抬高）：之前的判断不再成立，允许重新收紧 */
  release(): void {
    this.#lockedAt = null;
    this.#floor = 1;
    this.#floorWhileMoving = false;
    this.#saturated = false;
  }

  /** 一帧的判断；elapsedMs 是离上一帧的时间。返回值不是 steady 时要再画一帧 */
  update(pressure: CachePressure, pose: BudgetPose, elapsedMs: number): ScaleMotion {
    const { hardBytes } = this.#budget;
    const { refused, cachedBytes, pinnedBytes, pendingBytes, usedTiles } = pressure;
    this.#stillMs = this.#lastPose && !samePose(this.#lastPose, pose) ? 0 : this.#stillMs + elapsedMs;
    this.#lastPose = pose;
    const settled = this.#stillMs >= SETTLE_MS;
    if (this.#lockedAt && (movedAway(this.#lockedAt, pose) || (this.#floorWhileMoving && settled))) {
      this.release();
    }
    const demand = pinnedBytes + pendingBytes;
    const full = refused > 0 && cachedBytes - pinnedBytes < hardBytes * EVICTABLE_RATIO;
    const rate = RATE_PER_FRAME ** (Math.min(elapsedMs, MAX_ELAPSED_MS) / FRAME_MS);
    if ((full || demand >= hardBytes * PREDICT_RATIO) && !this.#saturated && this.#value < MAX_SCALE) {
      this.#raise(rate, pose, usedTiles);
      return this.#saturated ? 'steady' : 'raising';
    }
    if (refused > 0 && !full) {
      this.#evictStalledMs = cachedBytes < this.#lastCachedBytes ? 0 : this.#evictStalledMs + elapsedMs;
      this.#lastCachedBytes = cachedBytes;
      return this.#evictStalledMs < EVICT_STALL_MS ? 'evicting' : 'steady';
    }
    this.#lastCachedBytes = Number.POSITIVE_INFINITY;
    this.#evictStalledMs = 0;
    if (this.#value > this.#floor && demand < hardBytes * LOWER_RATIO) {
      if (!settled) {
        return 'settling';
      }
      this.#value = Math.max(this.#floor, this.#value / rate);
      return 'lowering';
    }
    return this.#floorWhileMoving ? 'settling' : 'steady';
  }

  #raise(rate: number, pose: BudgetPose, usedTiles: number): void {
    if (!this.#lockedAt) {
      this.#baseValue = this.#value;
      this.#baseTiles = usedTiles;
    }
    this.#lockedAt = pose;
    this.#floorWhileMoving = this.#stillMs < SETTLE_MS;
    this.#floor = Math.min(MAX_SCALE, this.#value * RATE_PER_FRAME);
    this.#value = Math.max(this.#floor, Math.min(MAX_SCALE, this.#value * rate));
    if (usedTiles < this.#baseTiles) {
      this.#baseValue = this.#value;
      this.#baseTiles = usedTiles;
    } else if (this.#value >= this.#baseValue * SATURATE_FACTOR) {
      this.#saturated = true;
    }
  }
}
