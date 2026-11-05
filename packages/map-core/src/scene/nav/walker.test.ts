// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT } from '../route-path';
import { buildNavGrid } from './heightfield';
import { NavGrid } from './nav-grid';
import { floorQuad, triangles, twoLevelStation, wallQuad } from './nav-testing';
import { labelRegions } from './regions';
import {
  chooseSpawn,
  headingToYaw,
  planMove,
  resolveClick,
  type SpawnContext,
  unstuckSpot,
  walkAxes,
  Walker,
  yawToHeading
} from './walker';

const EAST = Math.PI / 2;
const NORTH = 0;

// 20 × 6 米的走廊，3 米高的顶板；x = 10.1 处一堵墙，door 为 0 时两边隔开，否则从 y = 2 开始留 door 米宽的门
function corridor(door: number) {
  const walls =
    door > 0
      ? [wallQuad(10.1, 0, 10.1, 2, 0, 3), wallQuad(10.1, 2 + door, 10.1, 6, 0, 3)]
      : [wallQuad(10.1, 0, 10.1, 6, 0, 3)];
  return gridOf(floorQuad(0, 0, 20, 6, 0), floorQuad(0, 0, 20, 6, 3), ...walls);
}

function gridOf(...parts: number[][]) {
  return new NavGrid(labelRegions(buildNavGrid([triangles(...parts)])));
}

const open = corridor(1.2);
const closed = corridor(0);
const station = new NavGrid(labelRegions(buildNavGrid([twoLevelStation()])));
const preferred = { point: [5, 6, -10], yaw: 1 } satisfies SpawnContext['preferred'];
const seeAll = () => true;
const seeNothing = () => false;

// 出生点在 (x, y) 附近半米内
const near = (spawn: { x: number; y: number } | null, x: number, y: number) =>
  spawn !== null && Math.hypot(spawn.x - x, spawn.y - y) < 0.5;

// 往前走 distance 米：每 50 毫秒一帧挪 0.5 米，视点跟着地板
function walkFor(walker: Walker, distance: number) {
  for (let left = distance; left > 0; left -= 0.5) {
    walker.walk(1, 0, Math.min(0.5, left));
    walker.settleEye(0.05);
  }
}

describe('walkAxes、朝向换算', () => {
  it('W/S、↑/↓ 前后，A/D 平移，←/→ 转向；同时按相反的两个键抵消', () => {
    expect(walkAxes(new Set(['KeyW', 'KeyD']))).toStrictEqual({ forward: 1, strafe: 1, turn: 0 });
    expect(walkAxes(new Set(['ArrowDown', 'ArrowLeft']))).toStrictEqual({ forward: -1, strafe: 0, turn: -1 });
    expect(walkAxes(new Set(['KeyA', 'KeyD', 'ArrowRight']))).toStrictEqual({ forward: 0, strafe: 0, turn: 1 });
  });

  it('清单的朝向减去局部 y 轴的方位角就是局部的偏航，换回来在 0～360 之间', () => {
    expect(headingToYaw(76, 0)).toBeCloseTo((76 * Math.PI) / 180, 9);
    expect(headingToYaw(90, 30)).toBeCloseTo(Math.PI / 3, 9);
    expect(yawToHeading(Math.PI / 3, 30)).toBeCloseTo(90, 9);
    expect(yawToHeading(-Math.PI / 2, 10)).toBeCloseTo(280, 9);
  });
});

describe('Walker 的行走', () => {
  it('朝东走 3 米：x 加 3，脚下仍是地板 0，视点在眼高；俯仰限制在 ±80°', () => {
    const walker = new Walker(open, { x: 2, y: 3, floor: 0, yaw: EAST });
    expect(walker.walk(1, 0, 3)).toBe(true);
    expect(walker.position.x).toBeCloseTo(5, 6);
    expect(walker.position.y).toBeCloseTo(3, 6);
    expect(walker.position.floor).toBe(0);
    expect(walker.eye).toBe(EYE_HEIGHT);
    walker.turn(0, 2);
    expect(walker.pitch).toBeCloseTo((80 * Math.PI) / 180, 9);
  });

  it('A/D 平移：朝东时 D 往南、A 往北', () => {
    const walker = new Walker(open, { x: 5, y: 3, floor: 0, yaw: EAST });
    walker.walk(0, 1, 1);
    expect(walker.position.y).toBeCloseTo(2, 6);
    walker.walk(0, -1, 2);
    expect(walker.position.y).toBeCloseTo(4, 6);
  });

  it('墙挡住：停在墙前一个身位，不会穿过去', () => {
    const walker = new Walker(closed, { x: 8, y: 1, floor: 0, yaw: EAST });
    walkFor(walker, 5);
    expect(walker.position.x).toBeLessThan(10.1 - 0.29);
    expect(walker.position.x).toBeGreaterThan(9.5);
    expect(walker.walk(1, 0, 0.5)).toBe(false);
  });

  it('斜着撞墙时顺着墙滑：继续往北走，不停在原地', () => {
    const walker = new Walker(closed, { x: 9.5, y: 1, floor: 0, yaw: Math.PI / 4 });
    walkFor(walker, 4);
    expect(walker.position.x).toBeLessThan(10.1 - 0.29);
    expect(walker.position.y).toBeGreaterThan(2.5);
  });

  it('楼梯按每格的地板高度爬升：从 -10 米走上 -5 米那一层，视点随后到位', () => {
    const walker = new Walker(station, { x: 9, y: 6, floor: -10, yaw: NORTH });
    walkFor(walker, 15);
    expect(walker.position.y).toBeCloseTo(21, 6);
    expect(walker.position.floor).toBeCloseTo(-5, 1);
    while (walker.settleEye(0.05)) {
      // 一帧 50 毫秒，直到到位
    }
    expect(walker.eye).toBeCloseTo(walker.position.floor + EYE_HEIGHT, 6);
  });

  it('地板突然升高时视点平滑跟上，但最多比眼高低 0.4 米，不会切进台阶', () => {
    const walker = new Walker(open, { x: 2, y: 3, floor: 0, yaw: EAST });
    walker.startRoute([walker.position, { x: 3, y: 3, floor: 1 }], true);
    expect(walker.follow(2)).toBe('arrived');
    // 按走过的比例过渡，最后正好落在终点的地板上，不留浮点误差
    expect(walker.position.floor).toBe(1);
    expect(walker.settleEye(0.01)).toBe(true);
    expect(walker.eye).toBeCloseTo(1 + EYE_HEIGHT - 0.4, 9);
  });
});

describe('点击移动', () => {
  it('同一区域里点中地板：寻路穿过门，沿路径走到落点；键盘一动就打断', () => {
    const walker = new Walker(open, { x: 3, y: 1, floor: 0, yaw: EAST });
    const click = resolveClick(walker, [17, 1, 0], seeNothing);
    expect(click).toMatchObject({ kind: 'go', reachable: true, target: { direct: true, floor: 0 } });
    if (click.kind !== 'go') {
      throw new Error('应该能去');
    }
    const plan = planMove(walker, click.target, click.reachable, seeNothing, 'first');
    expect(plan.kind).toBe('route');
    if (plan.kind !== 'route') {
      throw new Error('应该沿路径走');
    }
    expect(plan.points[0]).toStrictEqual({ x: 3, y: 1, floor: 0 });
    // 拉直后经过门口
    expect(plan.points.some(({ x, y }) => Math.abs(x - 10.1) < 1 && y > 2 && y < 3.2)).toBe(true);
    walker.startRoute(plan.points, false);
    expect(walker.destination).toMatchObject({ floor: 0 });
    let step = walker.follow(1);
    while (step === 'moving') {
      step = walker.follow(1);
    }
    expect(step).toBe('arrived');
    expect(walker.position.x).toBeCloseTo(click.target.x, 6);
    expect(walker.destination).toBeNull();

    walker.startRoute(plan.points, false);
    walker.walk(1, 0, 0.1);
    expect(walker.destination).toBeNull();
  });

  it('没点到东西、点在顶板上（另一块小区域、高差大）：不去', () => {
    const walker = new Walker(open, { x: 3, y: 1, floor: 0, yaw: EAST });
    expect(resolveClick(walker, null, seeAll)).toStrictEqual({ kind: 'refuse', reason: 'not-standable' });
    // 墙中间的竖面：附近 0.45 米内没有地板
    expect(resolveClick(walker, [10.1, 1, 1.5], seeAll)).toStrictEqual({ kind: 'refuse', reason: 'not-standable' });
  });

  it('和脚下高差超过 0.5 米的一小块平台（柜顶之类）：不去', () => {
    const room = gridOf(floorQuad(0, 0, 10, 6, 0), floorQuad(0, 0, 10, 6, 3), floorQuad(4, 2, 5.2, 3.2, 1));
    const walker = new Walker(room, { x: 1, y: 1, floor: 0, yaw: EAST });
    expect(room.componentAt(4.6, 2.6, 1)).toBeGreaterThan(0);
    expect(resolveClick(walker, [4.6, 2.6, 1], seeAll)).toStrictEqual({ kind: 'refuse', reason: 'not-standable' });
  });

  it('墙那边的地面：近处、视点高度通畅就直线穿过去，否则闪切；第三人称一律闪切；穿过时地板按比例过渡，最后落在目标上', () => {
    const walker = new Walker(closed, { x: 8, y: 3, floor: 0, yaw: EAST });
    const click = resolveClick(walker, [12, 3, 0], seeNothing);
    expect(click).toMatchObject({ kind: 'go', reachable: false, target: { direct: true } });
    if (click.kind !== 'go') {
      throw new Error('应该能去');
    }
    const teleport = { kind: 'teleport', spot: { x: click.target.x, y: click.target.y, floor: 0 } };
    expect(planMove(walker, click.target, false, seeNothing, 'first')).toStrictEqual(teleport);
    expect(planMove(walker, click.target, false, seeAll, 'third')).toStrictEqual(teleport);
    const plan = planMove(walker, click.target, false, seeAll, 'first');
    if (plan.kind !== 'through') {
      throw new Error(`应该直线穿过去：${plan.kind}`);
    }
    walker.startRoute(plan.points, true);
    expect(walker.follow(20)).toBe('arrived');
    expect(walker.position).toMatchObject({ x: click.target.x, floor: 0 });
  });

  it('中间隔着一大片站不住的地方（超过 3 米）：看得见也闪切，不直线穿过', () => {
    const gap = gridOf(floorQuad(0, 0, 5, 6, 0), floorQuad(9, 0, 14, 6, 0), floorQuad(0, 0, 14, 6, 3));
    const walker = new Walker(gap, { x: 3, y: 3, floor: 0, yaw: EAST });
    const click = resolveClick(walker, [11, 3, 0], seeAll);
    if (click.kind !== 'go') {
      throw new Error('应该能去');
    }
    expect(planMove(walker, click.target, click.reachable, seeAll, 'first').kind).toBe('teleport');
  });

  it('点墙根反推出来的落点在别的区域：看不见就不去', () => {
    const walker = new Walker(closed, { x: 8, y: 3, floor: 0, yaw: EAST });
    // 墙东面的墙根，离西边能站的地方超过 0.6 米
    const pick: [number, number, number] = [10.6, 3, 0.3];
    expect(resolveClick(walker, pick, seeNothing)).toStrictEqual({ kind: 'refuse', reason: 'hidden' });
    expect(resolveClick(walker, pick, seeAll)).toMatchObject({
      kind: 'go',
      reachable: false,
      target: { direct: false }
    });
  });

  it('路径受阻时停下，报告 blocked', () => {
    const walker = new Walker(closed, { x: 8, y: 3, floor: 0, yaw: EAST });
    walker.startRoute([walker.position, { x: 12, y: 3, floor: 0 }], false);
    expect(walker.follow(10)).toBe('blocked');
    expect(walker.destination).toBeNull();
    expect(walker.position.x).toBeLessThan(10.1);
  });
});

describe('脱困与出生点', () => {
  it('开阔处不用脱困；贴着墙角时挪到附近的开阔地面；整片地面太小时没有去处', () => {
    expect(unstuckSpot(new Walker(open, { x: 5, y: 3, floor: 0, yaw: 0 }))).toStrictEqual({ kind: 'open' });
    const corner = unstuckSpot(new Walker(open, { x: 0.4, y: 0.4, floor: 0, yaw: 0 }));
    if (corner.kind !== 'move') {
      throw new Error(`墙角应该挪开：${corner.kind}`);
    }
    expect(open.isOpen(corner.spot.x, corner.spot.y, corner.spot.floor, 0.6)).toBe(true);
    expect(Math.hypot(corner.spot.x - 0.4, corner.spot.y - 0.4)).toBeLessThan(1.5);
    const room = gridOf(floorQuad(0, 0, 4, 4, 0), floorQuad(0, 0, 4, 4, 3));
    expect(unstuckSpot(new Walker(room, { x: 0.4, y: 0.4, floor: 0, yaw: 0 }))).toStrictEqual({ kind: 'none' });
  });

  const far: SpawnContext = { eye: [0, 0, 500], eyeHeight: 500, ground: null, yaw: 0.3, preferred, groundHeight: 0 };

  it('相机已在站内地下：落到脚下附近的地板，朝向沿用相机；出生点之前先看这一条', () => {
    const spawn = chooseSpawn(station, { ...far, eye: [12, 25, -3.4], eyeHeight: -3.4 });
    expect(spawn).toMatchObject({ floor: -5, yaw: 0.3 });
    expect(near(spawn, 12, 25)).toBe(true);
  });

  it('贴近地面、画布中心对着模型：下到最上面一层；相机高了就用清单的出生点和朝向', () => {
    const low = chooseSpawn(station, { ...far, eye: [5, 10, 150], eyeHeight: 150, ground: [5, 23, 0] });
    expect(low).toMatchObject({ floor: -5, yaw: 0.3 });
    expect(near(low, 5, 23)).toBe(true);
    const high = chooseSpawn(station, { ...far, eye: [5, 10, 300], eyeHeight: 300, ground: [5, 23, 0] });
    expect(high).toMatchObject({ floor: -10, yaw: 1 });
    expect(near(high, 5, 6)).toBe(true);
  });

  it('都不满足时取模型中心附近最上面一层；没有室内地板时为 null', () => {
    expect(chooseSpawn(station, { ...far, preferred: null })).toMatchObject({ yaw: 0.3 });
    const roof = gridOf(floorQuad(0, 0, 30, 30, -5));
    expect(chooseSpawn(roof, { ...far, preferred: null })).toBeNull();
  });
});
