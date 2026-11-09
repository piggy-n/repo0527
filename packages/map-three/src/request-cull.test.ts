// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { RequestCull } from './request-cull';

const at = (x: number): [number, number, number] => [x, 0, 0];

// 匀速走几帧：speed 米/秒，frameMs 毫秒一帧
function moving(speed: number, frameMs: number, frames = 5): RequestCull {
  const cull = new RequestCull(1);
  for (let frame = 0; frame <= frames; frame++) {
    cull.update(at((speed * frame * frameMs) / 1000), frame * frameMs);
  }
  return cull;
}

describe('RequestCull', () => {
  it('第一帧还不知道相机动不动：先不请求，相机没动的话下一帧就请求', () => {
    const cull = new RequestCull(1);
    cull.update(at(1000), 0);
    expect(cull.culls(1)).toBe(true);
    expect(cull.culls(1e9)).toBe(true);
    cull.update(at(1000), 16);
    expect(cull.culls(1)).toBe(false);
  });

  it('第一帧之后相机在动：马上按速度算', () => {
    const cull = new RequestCull(1);
    cull.update(at(0), 0);
    cull.update(at(10), 20);
    expect(cull.culls(100)).toBe(true);
    expect(cull.culls(300)).toBe(false);
  });

  it('相机一秒走的路达到瓦片直径就不请求', () => {
    // 470 米/秒，经开区 z16 倾斜飞行的速度
    const cull = moving(470, 20);
    expect(cull.culls(100)).toBe(true);
    expect(cull.culls(234)).toBe(true);
    expect(cull.culls(236)).toBe(false);
  });

  it('按时间算，和帧率无关', () => {
    for (const frameMs of [4, 16.7, 50, 200]) {
      const cull = moving(100, frameMs);
      expect(cull.culls(49)).toBe(true);
      expect(cull.culls(51)).toBe(false);
    }
  });

  it('窗口是参数：窗口短，一样的速度放行更多', () => {
    const cull = new RequestCull(0.5);
    cull.update(at(0), 0);
    cull.update(at(100), 1000);
    expect(cull.culls(24)).toBe(true);
    expect(cull.culls(26)).toBe(false);
  });

  it('按三个方向的距离算', () => {
    const cull = new RequestCull(1);
    cull.update([0, 0, 0], 0);
    cull.update([30, 40, 0], 1000);
    expect(cull.culls(24)).toBe(true);
    expect(cull.culls(26)).toBe(false);
  });

  it('一帧算出的速度抖一下不放行：实测 150 米/秒时有一帧算成 54', () => {
    const cull = moving(150, 18);
    const last = (150 * 5 * 18) / 1000;
    cull.update(at(last + 0.98), 6 * 18);
    expect(cull.culls(35.7)).toBe(true);
  });

  it('相机停下以后大的瓦片先放行，一直停着都会放行', () => {
    const cull = moving(470, 20);
    const stopped = (470 * 5 * 20) / 1000;
    const still = (untilMs: number, fromMs: number) => {
      for (let time = fromMs + 20; time <= untilMs; time += 20) {
        cull.update(at(stopped), time);
      }
    };
    still(120, 100);
    expect(cull.culls(100)).toBe(true);
    still(400, 120);
    expect(cull.culls(100)).toBe(false);
    expect(cull.culls(5)).toBe(true);
    still(1200, 400);
    expect(cull.culls(0)).toBe(false);
  });

  it('隔很久才又动一点：速度很小', () => {
    const cull = new RequestCull(1);
    cull.update(at(0), 0);
    cull.update(at(10), 60000);
    expect(cull.culls(1)).toBe(false);
  });

  it('很小的瓦片直径按 1 米算：几乎不动时照样请求', () => {
    expect(moving(0.5, 20).culls(0)).toBe(false);
    expect(moving(2, 20).culls(0)).toBe(true);
  });

  it('同一时刻又更新一次：不算数，速度不变', () => {
    const cull = moving(10, 20);
    cull.update(at(100), 100);
    expect(cull.culls(4)).toBe(true);
    expect(cull.culls(1000)).toBe(false);
    cull.update(at(1.2), 120);
    expect(cull.culls(4)).toBe(true);
    expect(cull.culls(1000)).toBe(false);
  });
});
