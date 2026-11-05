// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT } from '../route-path';
import { buildNavGrid } from './heightfield';
import { NavGrid } from './nav-grid';
import { floorQuad, triangles, wallQuad } from './nav-testing';
import { labelRegions } from './regions';
import { seeThroughAvatar, startPitch, WalkCycle, WalkRig } from './third-person';
import { Walker } from './walker';

const DEG = Math.PI / 180;
const EAST = Math.PI / 2;

function gridOf(...parts: number[][]) {
  return new NavGrid(labelRegions(buildNavGrid([triangles(...parts)])));
}

// 20 × 6 米的大厅，5 米高的顶板
const hall = gridOf(floorQuad(0, 0, 20, 6, 0), floorQuad(0, 0, 20, 6, 5));
// 3 米高的走廊，x = 10.1 处一堵墙把两边隔开
const walled = gridOf(floorQuad(0, 0, 20, 6, 0), floorQuad(0, 0, 20, 6, 3), wallQuad(10.1, 0, 10.1, 6, 0, 3));

// 原地每 50 毫秒一帧，直到臂不再伸缩（最多 frames 帧）
function settle(rig: WalkRig, walker: Walker, frames = 200) {
  for (let i = 0; i < frames; i++) {
    rig.step(walker.position, 0.05);
    if (!rig.settling) {
      return;
    }
  }
}

describe('WalkRig 的弹簧臂', () => {
  it('第三人称从眼睛处把相机拉出去，停在人后上方 4 米；人慢慢显出来', () => {
    const walker = new Walker(hall, { x: 10, y: 3, floor: 0, yaw: EAST });
    walker.look(EAST, startPitch('third'));
    const rig = new WalkRig(walker, 'third');
    expect(rig.arm).toBe(0);
    expect(rig.eye).toStrictEqual([10, 3, EYE_HEIGHT]);
    expect(rig.avatarAlpha).toBe(0);
    rig.step(walker.position, 0.05);
    expect(rig.settling).toBe(true);
    expect(rig.arm).toBeGreaterThan(0.6);
    expect(rig.arm).toBeLessThan(4);
    // 相机离人 0.6～1.4 米之间人半透明
    expect(rig.avatarAlpha).toBeCloseTo((rig.arm - 0.6) / 0.8, 9);
    settle(rig, walker);
    expect(rig.settling).toBe(false);
    expect(rig.arm).toBe(4);
    expect(rig.avatarAlpha).toBe(1);
    // 朝东俯看 18°：相机在西边、抬高，绕点比眼睛高 0.25 米
    const [x, y, z] = rig.eye;
    expect(x).toBeCloseTo(10 - Math.cos(18 * DEG) * 4, 6);
    expect(y).toBeCloseTo(3, 6);
    expect(z).toBeCloseTo(EYE_HEIGHT + 0.25 + Math.sin(18 * DEG) * 4, 6);
  });

  it('身后有墙：臂停在墙前，相机不进墙；离开墙慢慢放长，再靠近立即缩短', () => {
    const walker = new Walker(walled, { x: 12, y: 3, floor: 0, yaw: EAST });
    const rig = new WalkRig(walker, 'third');
    settle(rig, walker);
    expect(rig.arm).toBeLessThan(2);
    expect(rig.eye[0]).toBeGreaterThan(10.1 + 0.2);
    walker.placeAt({ x: 17, y: 3, floor: 0 });
    const before = rig.arm;
    rig.step(walker.position, 0.05);
    expect(rig.arm).toBeGreaterThan(before);
    expect(rig.arm).toBeLessThan(4);
    settle(rig, walker);
    expect(rig.arm).toBe(4);
    walker.placeAt({ x: 12, y: 3, floor: 0 });
    rig.step(walker.position, 0.05);
    expect(rig.arm).toBeLessThan(2);
    expect(rig.eye[0]).toBeGreaterThan(10.1 + 0.2);
  });

  it('滚轮调远近：第三人称在 1.5～8 米之间，第一人称不变', () => {
    const walker = new Walker(hall, { x: 10, y: 3, floor: 0, yaw: EAST });
    const rig = new WalkRig(walker, 'third');
    rig.zoom(100);
    expect(rig.distance).toBeCloseTo(4 * Math.exp(0.15), 9);
    rig.zoom(10000);
    expect(rig.distance).toBe(8);
    rig.zoom(-10000);
    expect(rig.distance).toBe(1.5);
    const first = new WalkRig(walker, 'first');
    first.zoom(100);
    expect(first.distance).toBe(4);
    settle(first, walker);
    expect(first.arm).toBe(0);
  });
});

describe('WalkRig 的人称', () => {
  it('切到第三人称：人面朝刚才看的方向，至少俯看 18°，俯仰限制在 -75°～25°；切回第一人称恢复 ±80°', () => {
    const walker = new Walker(hall, { x: 10, y: 3, floor: 0, yaw: EAST });
    walker.look(EAST, 30 * DEG);
    // 第三人称的范围窄一些，现在的俯仰随即夹进去
    expect(new WalkRig(walker, 'third').view).toBe('third');
    expect(walker.pitch).toBeCloseTo(25 * DEG, 9);
    walker.limitPitch(-80 * DEG, 80 * DEG);
    walker.look(1, 30 * DEG);
    const rig = new WalkRig(walker, 'first');
    rig.setView('third');
    expect(rig.view).toBe('third');
    expect(rig.bodyYaw).toBe(1);
    expect(walker.pitch).toBeCloseTo(-18 * DEG, 9);
    walker.turn(0, 2);
    expect(walker.pitch).toBeCloseTo(25 * DEG, 9);
    walker.turn(0, -4);
    expect(walker.pitch).toBeCloseTo(-75 * DEG, 9);
    rig.setView('first');
    walker.turn(0, -1);
    expect(walker.pitch).toBeCloseTo(-80 * DEG, 9);
  });

  it('切回第一人称：臂慢慢收回到 0，人随之淡出', () => {
    const walker = new Walker(hall, { x: 10, y: 3, floor: 0, yaw: EAST });
    const rig = new WalkRig(walker, 'third');
    settle(rig, walker);
    rig.setView('first');
    rig.step(walker.position, 0.05);
    expect(rig.arm).toBeGreaterThan(2);
    expect(rig.settling).toBe(true);
    settle(rig, walker);
    expect(rig.arm).toBe(0);
    expect(rig.avatarAlpha).toBe(0);
    expect(rig.eye).toStrictEqual([10, 3, EYE_HEIGHT]);
  });

  it('第三人称往后走：人限速转过身来；第一人称人面朝视线；闪切不算走路', () => {
    const walker = new Walker(hall, { x: 10, y: 3, floor: 0, yaw: EAST });
    const rig = new WalkRig(walker, 'third');
    let from = walker.position;
    walker.walk(-1, 0, 0.1);
    expect(rig.step(from, 0.05)).toBeCloseTo(0.1, 9);
    // 每秒 540°，一帧 50 毫秒转 27°
    expect(rig.bodyYaw).toBeCloseTo(EAST + 27 * DEG, 9);
    for (let i = 0; i < 10; i++) {
      from = walker.position;
      walker.walk(-1, 0, 0.1);
      rig.step(from, 0.05);
    }
    expect(Math.sin(rig.bodyYaw)).toBeCloseTo(-1, 9);
    from = walker.position;
    walker.placeAt({ x: 15, y: 3, floor: 0 });
    expect(rig.step(from, 0.05)).toBe(0);

    const first = new WalkRig(walker, 'first');
    walker.look(2, 0);
    first.step(walker.position, 0.05);
    expect(first.bodyYaw).toBe(2);
  });
});

describe('seeThroughAvatar', () => {
  const feet = { x: 10, y: 3, floor: 0 };
  const camera: [number, number, number] = [6, 3, 3];

  it('点在人身上：顺着视线穿过人物，落到人背后的地板上', () => {
    const point = seeThroughAvatar(hall, feet, camera, [10, 3, 1.2]);
    if (!point) {
      throw new Error('应该找到人背后的地板');
    }
    // 视线每米下降 1.8 / 4，从 1.2 米高降到地板
    expect(point[0]).toBeCloseTo(10 + (1.2 / 1.8) * 4, 1);
    expect(point[1]).toBeCloseTo(3, 6);
    expect(Math.abs(point[2])).toBeLessThan(0.05);
  });

  it('不在人身上（离开半米、脚下的地板、头顶以上）：原样返回', () => {
    for (const picked of [
      [11, 3, 1],
      [10, 3, 0.02],
      [10, 3, 2]
    ] satisfies [number, number, number][]) {
      expect(seeThroughAvatar(hall, feet, camera, picked)).toBe(picked);
    }
  });
});

describe('WalkCycle', () => {
  it('相位按走过的距离推进：1.5 米一个周期', () => {
    const cycle = new WalkCycle();
    expect(cycle.advance(0.75, 0.016)).toBe(true);
    expect(cycle.phase).toBeCloseTo(0.5, 9);
    expect(cycle.walking).toBe(true);
  });

  it('停下后把这一步走完：到两腿交错的时刻（0.25、0.75……）才停', () => {
    const cycle = new WalkCycle();
    cycle.advance(0.75, 0.016);
    // 每秒 1.5 个周期
    expect(cycle.advance(0, 0.1)).toBe(true);
    expect(cycle.phase).toBeCloseTo(0.65, 9);
    expect(cycle.advance(0, 0.1)).toBe(false);
    expect(cycle.phase).toBeCloseTo(0.75, 9);
    expect(cycle.advance(0, 0.1)).toBe(false);
    expect(cycle.phase).toBeCloseTo(0.75, 9);
  });

  it('正好停在两腿交错的时刻：立即站定', () => {
    const cycle = new WalkCycle();
    cycle.advance(0.375, 0.016);
    expect(cycle.phase).toBeCloseTo(0.25, 9);
    expect(cycle.advance(0, 0.1)).toBe(false);
    expect(cycle.phase).toBeCloseTo(0.25, 9);
  });

  it('没走过就不放动画', () => {
    expect(new WalkCycle().advance(0, 0.1)).toBe(false);
  });
});
