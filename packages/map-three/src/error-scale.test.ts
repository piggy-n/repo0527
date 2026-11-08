// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { type BudgetPose, type CachePressure, ErrorScale } from './error-scale';

const MB = 1024 * 1024;
const BUDGET = { softBytes: 1024 * MB, hardBytes: 1536 * MB };
// 收紧的线：上限的 90%
const FRAME = 1000 / 60;
const POSE: BudgetPose = { position: [0, 1000, 0], direction: [0, -1, 0], height: 1000 };
const NONE: CachePressure = { refused: 0, cachedBytes: 0, pinnedBytes: 0, pendingBytes: 0, usedTiles: 0 };

// 粗的世界模型（同 3C.4 设计里的模拟）：blocks 个等距的块，每块第 n 层有 4^n 块瓦片，每层的字节数来自 JKQ2 的实测；
// 目标屏幕误差小于这一层的屏幕误差才要下一层，祖先一直占着；一帧加载 loadPerFrame 块瓦片
const LEVEL_BYTES = [1, 20, 150, 270].map(mb => mb * MB);
const LEVEL_ERROR = [7.1, 3.55, 1.78, 0.89];

class World {
  readonly #blocks: readonly number[];
  readonly #loadPerFrame: number;
  readonly #loaded = new Map<string, number>();
  // 同层的瓦片加载后知道的大小
  readonly #sizes = new Map<number, number>();
  base = 4;
  // 累计：加载过的字节，曾经卸载、又加载回来的字节
  loadedBytes = 0;
  reloadedBytes = 0;
  readonly #everLoaded = new Set<string>();

  constructor(blocks: readonly number[], loadPerFrame = 8) {
    this.#blocks = blocks;
    this.#loadPerFrame = loadPerFrame;
  }

  // 一帧：按倍数算要哪些瓦片，装能装下的，淘汰不用的，给出缓存状况
  step(scale: number, { softBytes, hardBytes }: typeof BUDGET): CachePressure {
    const target = this.base * scale;
    const used = new Set<string>();
    const wanted: { readonly tile: string; readonly level: number }[] = [];
    this.#blocks.forEach((factor, block) => {
      let level = 0;
      while (level < LEVEL_ERROR.length - 1 && (LEVEL_ERROR[level] ?? 0) * factor > target) {
        level++;
      }
      for (let l = 0; l <= level; l++) {
        for (let i = 0; i < 4 ** l; i++) {
          const tile = `${block}/${l}/${i}`;
          used.add(tile);
          if (!this.#loaded.has(tile)) {
            wanted.push({ tile, level: l });
          }
        }
      }
    });
    wanted.sort((a, b) => a.level - b.level);
    let cached = 0;
    for (const bytes of this.#loaded.values()) {
      cached += bytes;
    }
    let budget = this.#loadPerFrame;
    let refused = 0;
    const remaining: typeof wanted = [];
    for (const item of wanted) {
      if (cached >= hardBytes) {
        refused++;
        remaining.push(item);
      } else if (budget > 0) {
        budget--;
        const bytes = (LEVEL_BYTES[item.level] ?? 0) / 4 ** item.level;
        this.#loaded.set(item.tile, bytes);
        this.#sizes.set(item.level, bytes);
        cached += bytes;
        this.loadedBytes += bytes;
        if (this.#everLoaded.has(item.tile)) {
          this.reloadedBytes += bytes;
        }
        this.#everLoaded.add(item.tile);
      } else {
        remaining.push(item);
      }
    }
    // 每帧最多淘汰下限的 5%，只淘汰不用的
    let quota = softBytes * 0.05;
    if (cached > softBytes) {
      for (const [tile, bytes] of this.#loaded) {
        if (quota <= 0 || cached <= softBytes) {
          break;
        }
        if (!used.has(tile)) {
          this.#loaded.delete(tile);
          cached -= bytes;
          quota -= bytes;
        }
      }
    }
    let pinned = 0;
    for (const tile of used) {
      pinned += this.#loaded.get(tile) ?? 0;
    }
    const deepest = Math.max(0, ...this.#sizes.values());
    const pending = remaining.reduce((sum, { level }) => sum + (this.#sizes.get(level) ?? deepest), 0);
    return { refused, cachedBytes: cached, pinnedBytes: pinned, pendingBytes: pending, usedTiles: used.size };
  }
}

// 跑 seconds 秒；记下倍数的变化次数和最后一次变化的时间
function run(world: World, scale: ErrorScale, seconds: number, pose: BudgetPose = POSE) {
  let lastChange = 0;
  let changes = 0;
  let last: CachePressure = NONE;
  for (let frame = 0; frame < seconds * 60; frame++) {
    last = world.step(scale.value, BUDGET);
    const before = scale.value;
    scale.update(last, pose, FRAME);
    if (scale.value !== before) {
      changes++;
      lastChange = frame / 60;
    }
  }
  return { changes, lastChange, last };
}

const flat = (count: number, factor = 1) => Array.from({ length: count }, (_, i) => factor * (1 + 0.02 * Math.sin(i)));
const sloped = (count: number, near: number, far: number) =>
  Array.from({ length: count }, (_, i) => near + ((far - near) * i) / (count - 1));

// 飞行中：每帧挪一点
const flying = (frame: number): BudgetPose => ({ ...POSE, position: [frame * 0.5, 1000, 0] });

describe('ErrorScale', () => {
  it('放得下时不放宽', () => {
    const scale = new ErrorScale(BUDGET);
    const { changes, last } = run(new World(flat(20)), scale, 10);
    expect(changes).toBe(0);
    expect(scale.value).toBe(1);
    expect(last.refused).toBe(0);
  });

  it('俯视时一整层放不下：放宽到整层丢掉后停住，不再加载回来（JKQ 的来回折腾）', () => {
    const world = new World(flat(246));
    const scale = new ErrorScale(BUDGET);
    const first = run(world, scale, 5);
    // 第 0 层的屏幕误差约 7.1，目标 4：放宽到 1.8 倍以上才不要第 1 层
    expect(scale.value).toBeGreaterThan(1.75);
    expect(scale.value).toBeLessThan(2.1);
    expect(first.last.refused).toBe(0);
    const { loadedBytes } = world;
    // 再过一分钟，同一个姿态：倍数和加载的字节都不再变
    const later = run(world, scale, 60);
    expect(later.changes).toBe(0);
    expect(world.loadedBytes).toBe(loadedBytes);
    expect(world.reloadedBytes).toBe(0);
  });

  it('倾斜时只放宽到放得下：显存用得上，不冲过头', () => {
    const world = new World(sloped(120, 12, 0.5));
    world.base = 16;
    const scale = new ErrorScale(BUDGET);
    const { last } = run(world, scale, 10);
    expect(last.refused).toBe(0);
    expect(scale.value).toBeGreaterThan(1);
    // 差一步也不能差太多：显存至少用到下限
    expect(last.pinnedBytes).toBeGreaterThan(BUDGET.softBytes);
    expect(last.pinnedBytes).toBeLessThanOrEqual(BUDGET.hardBytes * 1.02);
  });

  it('锁定时显存再低也不收紧，相机离开才收紧', () => {
    const scale = new ErrorScale(BUDGET);
    const full = { ...NONE, refused: 5, cachedBytes: 1536 * MB, pinnedBytes: 1536 * MB, usedTiles: 100 };
    expect(scale.update(full, POSE, FRAME)).toBe('raising');
    const raised = scale.value;
    expect(raised).toBeGreaterThan(1);
    expect(scale.locked).toBe(true);
    // 整级丢掉，显存远低于下限：同一个姿态不动
    expect(scale.update({ ...NONE, pinnedBytes: 100 * MB, usedTiles: 10 }, POSE, FRAME)).toBe('steady');
    expect(scale.value).toBe(raised);
    // 走了不到高度的 25%：还算这个姿态
    const near: BudgetPose = { ...POSE, position: [200, 1000, 0] };
    expect(scale.update({ ...NONE, pinnedBytes: 100 * MB, usedTiles: 10 }, near, FRAME)).toBe('steady');
    // 走远了：解锁，相机停稳以后收紧
    const far: BudgetPose = { ...POSE, position: [300, 1000, 0] };
    expect(scale.update({ ...NONE, pinnedBytes: 100 * MB, usedTiles: 10 }, far, FRAME)).toBe('settling');
    expect(scale.locked).toBe(false);
    expect(scale.value).toBe(raised);
    expect(scale.update({ ...NONE, pinnedBytes: 100 * MB, usedTiles: 10 }, far, 600)).toBe('lowering');
    expect(scale.value).toBeLessThan(raised);
  });

  it('转过 10° 算换了姿态', () => {
    const scale = new ErrorScale(BUDGET);
    scale.update({ ...NONE, refused: 1, cachedBytes: 1536 * MB, pinnedBytes: 1536 * MB, usedTiles: 1 }, POSE, FRAME);
    const angle = (11 * Math.PI) / 180;
    const turned: BudgetPose = { ...POSE, direction: [Math.sin(angle), -Math.cos(angle), 0] };
    expect(scale.update({ ...NONE }, turned, FRAME)).toBe('settling');
    expect(scale.locked).toBe(false);
  });

  it('需求接近上限时不收紧：不贴着上限走', () => {
    const scale = new ErrorScale(BUDGET);
    scale.update({ ...NONE, refused: 1, cachedBytes: 1536 * MB, pinnedBytes: 1536 * MB, usedTiles: 1 }, POSE, 100);
    scale.release();
    const high = { ...NONE, pinnedBytes: 1400 * MB, usedTiles: 10 };
    expect(scale.update(high, POSE, 1000)).toBe('steady');
    const low = { ...NONE, pinnedBytes: 1300 * MB, usedTiles: 10 };
    expect(scale.update(low, POSE, FRAME)).toBe('lowering');
  });

  it('下探碰到放不下的一层：退回来再锁定，只折腾一次', () => {
    const world = new World(flat(246));
    const scale = new ErrorScale(BUDGET);
    run(world, scale, 5);
    const raised = scale.value;
    const { loadedBytes } = world;
    // 相机动了一下又回到差不多的距离：解锁、下探，预测到放不下，放宽回来再锁定
    const moved: BudgetPose = { ...POSE, position: [400, 1000, 0] };
    const { last } = run(world, scale, 5, moved);
    expect(scale.locked).toBe(true);
    expect(scale.value).toBeGreaterThanOrEqual(raised * 0.9);
    expect(last.refused).toBe(0);
    // 下探只多加载放得下的那部分，不会又把缓存装满一遍
    expect(world.loadedBytes - loadedBytes).toBeLessThan(BUDGET.hardBytes / 2);
    const { loadedBytes: settled } = world;
    const later = run(world, scale, 30, moved);
    expect(later.changes).toBe(0);
    expect(world.loadedBytes).toBe(settled);
  });

  it('最粗的一层也放不下：放宽几倍没有变化就停，不一直涨', () => {
    const scale = new ErrorScale(BUDGET);
    const stuck = { ...NONE, refused: 20, cachedBytes: 1536 * MB, pinnedBytes: 1536 * MB, usedTiles: 200 };
    let motion = scale.update(stuck, POSE, FRAME);
    let frames = 0;
    while (motion === 'raising' && frames < 1000) {
      motion = scale.update(stuck, POSE, FRAME);
      frames++;
    }
    expect(scale.saturated).toBe(true);
    expect(motion).toBe('steady');
    expect(scale.value).toBeLessThan(9);
    // 不再请求下一帧：按需渲染停得下来
    expect(scale.update(stuck, POSE, FRAME)).toBe('steady');
  });

  it('还有能淘汰的旧瓦片时不放宽，等淘汰', () => {
    const scale = new ErrorScale(BUDGET);
    const stale = { ...NONE, refused: 10, cachedBytes: 1536 * MB, pinnedBytes: 300 * MB, usedTiles: 30 };
    // 要再画一帧：淘汰以后才排得上
    expect(scale.update(stale, POSE, FRAME)).toBe('evicting');
    expect(scale.value).toBe(1);
  });

  it('淘汰没有进展就不等了：不会一直请求下一帧', () => {
    const scale = new ErrorScale(BUDGET);
    const stale = { ...NONE, refused: 10, cachedBytes: 1536 * MB, pinnedBytes: 300 * MB, usedTiles: 30 };
    const motions: string[] = [];
    for (let frame = 0; frame < 120; frame++) {
      motions.push(scale.update(stale, POSE, FRAME));
    }
    expect(motions[0]).toBe('evicting');
    expect(motions.at(-1)).toBe('steady');
    // 缓存又变小了：接着等
    expect(scale.update({ ...stale, cachedBytes: 1400 * MB }, POSE, FRAME)).toBe('evicting');
  });

  it('按时间折算：帧慢时一帧涨得多，但卡住的一帧有上限', () => {
    const full = { ...NONE, refused: 5, cachedBytes: 1536 * MB, pinnedBytes: 1536 * MB, usedTiles: 100 };
    const fast = new ErrorScale(BUDGET);
    fast.update(full, POSE, FRAME);
    expect(fast.value).toBeCloseTo(1.05, 5);
    const slow = new ErrorScale(BUDGET);
    slow.update(full, POSE, FRAME * 2);
    expect(slow.value).toBeCloseTo(1.05 ** 2, 5);
    const stalled = new ErrorScale(BUDGET);
    stalled.update(full, POSE, 5000);
    expect(stalled.value).toBeCloseTo(1.05 ** 6, 5);
  });

  it('帧慢时一步放过了头：收回到放不下的倍数再高一步，不再往下', () => {
    const scale = new ErrorScale(BUDGET);
    const full = { ...NONE, refused: 5, cachedBytes: 1536 * MB, pinnedBytes: 1536 * MB, usedTiles: 100 };
    scale.update(full, POSE, 100);
    expect(scale.value).toBeCloseTo(1.05 ** 6, 5);
    const light = { ...NONE, pinnedBytes: 100 * MB, usedTiles: 10 };
    let motion = scale.update(light, POSE, 100);
    expect(motion).toBe('lowering');
    for (let frame = 0; frame < 10; frame++) {
      motion = scale.update(light, POSE, FRAME);
    }
    expect(motion).toBe('steady');
    expect(scale.value).toBeCloseTo(1.05, 5);
    expect(scale.locked).toBe(true);
  });

  it('放不下和放得下交替（整级丢掉、又想加载回来）：同一个姿态下一定停下', () => {
    const scale = new ErrorScale(BUDGET);
    const full = { ...NONE, refused: 5, cachedBytes: 1536 * MB, pinnedBytes: 1536 * MB, usedTiles: 100 };
    const light = { ...NONE, pinnedBytes: 100 * MB, usedTiles: 10 };
    const round = () => {
      scale.update(full, POSE, FRAME);
      scale.update(light, POSE, FRAME);
      scale.update(light, POSE, FRAME);
      return scale.value;
    };
    for (let index = 0; index < 500; index++) {
      round();
    }
    const settled = scale.value;
    expect(settled).toBeLessThan(10);
    for (let index = 0; index < 100; index++) {
      expect(round()).toBe(settled);
    }
  });

  it('相机动着的时候定的下限：停稳后重新判断一次，停着定的不再放开', () => {
    const scale = new ErrorScale(BUDGET);
    const full = { ...NONE, refused: 5, cachedBytes: 1536 * MB, pinnedBytes: 1536 * MB, usedTiles: 100 };
    const light = { ...NONE, pinnedBytes: 100 * MB, usedTiles: 10 };
    // 飞行中：每帧挪一点，一直放不下
    let last = POSE;
    for (let frame = 0; frame < 20; frame++) {
      last = { ...POSE, position: [frame * 0.5, 1000, 0] };
      scale.update(full, last, FRAME);
    }
    const raised = scale.value;
    expect(scale.locked).toBe(true);
    // 动着的时候不收紧；停下：还没停稳时在等，要再画一帧，倍数不动
    expect(scale.update(light, { ...POSE, position: [10.5, 1000, 0] }, FRAME)).toBe('settling');
    expect(scale.value).toBe(raised);
    last = { ...POSE, position: [10.5, 1000, 0] };
    expect(scale.update(light, last, FRAME)).toBe('settling');
    expect(scale.value).toBe(raised);
    let motion = 'settling';
    for (let frame = 0; frame < 40 && motion === 'settling'; frame++) {
      motion = scale.update(light, last, FRAME);
    }
    // 停稳了：放开，收紧
    expect(motion).toBe('lowering');
    expect(scale.locked).toBe(false);
    for (let frame = 0; frame < 200; frame++) {
      scale.update(light, last, FRAME);
    }
    expect(scale.value).toBe(1);
    // 停着又放不下：这次的下限不再放开，帧也停得下来
    scale.update(full, last, FRAME);
    const held = scale.value;
    expect(held).toBeGreaterThan(1);
    for (let frame = 0; frame < 120; frame++) {
      expect(scale.update(light, last, FRAME)).toBe('steady');
    }
    expect(scale.value).toBe(held);
    expect(scale.locked).toBe(true);
  });

  it('相机动着的时候估计超线不放宽，真的放不下才放宽：一时超线不能让后面一路都画得粗', () => {
    const scale = new ErrorScale(BUDGET);
    // 估计的总量是上限的两倍，缓存还没满
    const predicted = { ...NONE, cachedBytes: 1100 * MB, pinnedBytes: 1100 * MB, pendingBytes: 2000 * MB, usedTiles: 100 };
    // 第一帧只是让它知道相机原来在哪：没有上一帧时算没动
    scale.update(NONE, flying(0), FRAME);
    for (let frame = 1; frame <= 60; frame++) {
      scale.update(predicted, flying(frame), FRAME);
    }
    expect(scale.value).toBe(1);
    expect(scale.locked).toBe(false);
    // 缓存真的满了，没有可淘汰的
    const full = { ...NONE, refused: 5, cachedBytes: 1536 * MB, pinnedBytes: 1536 * MB, usedTiles: 100 };
    expect(scale.update(full, flying(61), FRAME)).toBe('raising');
    expect(scale.value).toBeGreaterThan(1);
  });

  it('相机停稳以后估计超线就提前放宽，不等真的装满', () => {
    const scale = new ErrorScale(BUDGET);
    const predicted = { ...NONE, cachedBytes: 1100 * MB, pinnedBytes: 1100 * MB, pendingBytes: 2000 * MB, usedTiles: 100 };
    const moved: BudgetPose = { ...POSE, position: [100, 1000, 0] };
    scale.update(NONE, POSE, FRAME);
    // 刚动过：还不预测
    expect(scale.update(predicted, moved, FRAME)).not.toBe('raising');
    expect(scale.value).toBe(1);
    let motion = 'steady';
    for (let frame = 0; frame < 60 && motion !== 'raising'; frame++) {
      motion = scale.update(predicted, moved, FRAME);
    }
    expect(motion).toBe('raising');
    expect(scale.locked).toBe(true);
  });

  it('内容变了就解锁', () => {
    const scale = new ErrorScale(BUDGET);
    scale.update({ ...NONE, refused: 1, cachedBytes: 1536 * MB, pinnedBytes: 1536 * MB, usedTiles: 1 }, POSE, FRAME);
    scale.release();
    expect(scale.locked).toBe(false);
    expect(scale.update({ ...NONE }, POSE, FRAME)).toBe('lowering');
  });
});
