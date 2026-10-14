// @vitest-environment node
import type { ScreenPoint } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import {
  acceptsClick,
  type BoxGesture,
  cancelBox,
  drawingBox,
  moveBox,
  NO_BOX_GESTURE,
  pressBox,
  releaseBox
} from './box-gesture';

const START: ScreenPoint = { x: 100, y: 100 };
const at = (dx: number, dy = 0): ScreenPoint => ({ x: START.x + dx, y: START.y + dy });

// 按下后依次移动到这些点
function drag(...points: ScreenPoint[]): BoxGesture {
  return points.reduce(moveBox, pressBox(START));
}

describe('拖动框选的手势', () => {
  it('离起点不到 3 像素仍是单击：松手后不屏蔽单击，没有框', () => {
    const gesture = drag(at(2.99), at(0, 2.99), at(2, 2));
    expect(gesture.kind).toBe('pressed');

    const released = releaseBox(gesture, at(2, 2));

    expect(released).toStrictEqual({ gesture: NO_BOX_GESTURE, box: null });
    expect(acceptsClick(released.gesture)).toBe(true);
  });

  it('恰好 3 像素进入框选：松手给出框，屏蔽这次手势派生的单击', () => {
    const gesture = drag(at(3));
    expect(gesture).toStrictEqual({ kind: 'drawing', start: START, current: at(3) });

    const released = releaseBox(drag(at(3), at(40, 30)), at(50, 30));

    expect(released.box).toStrictEqual({ from: START, to: at(50, 30) });
    expect(acceptsClick(released.gesture)).toBe(false);
  });

  it('框选中跟着指针更新当前点，浮层画的就是它', () => {
    const gesture = drag(at(10), at(60, 20), at(30, 40));

    expect(drawingBox(gesture)).toStrictEqual({ from: START, to: at(30, 40) });
    expect(drawingBox(pressBox(START))).toBeNull();
    expect(drawingBox(NO_BOX_GESTURE)).toBeNull();
  });

  it('拖出后回到起点附近松手：没有框，单击仍被屏蔽', () => {
    const released = releaseBox(drag(at(50, 50), at(1, 1)), at(1, 1));

    expect(released.box).toBeNull();
    expect(acceptsClick(released.gesture)).toBe(false);
  });

  it('没收到移动、松手点离起点够远时按框选处理', () => {
    const released = releaseBox(pressBox(START), at(30, 30));

    expect(released.box).toStrictEqual({ from: START, to: at(30, 30) });
    expect(acceptsClick(released.gesture)).toBe(false);
  });

  it('按下后或框选中取消：结束手势、屏蔽单击，松手也不再给出框', () => {
    for (const gesture of [pressBox(START), drag(at(20, 20))]) {
      const cancelled = cancelBox(gesture);

      expect(cancelled.kind).toBe('idle');
      expect(acceptsClick(cancelled)).toBe(false);
      expect(releaseBox(cancelled, at(40, 40))).toStrictEqual({ gesture: cancelled, box: null });
    }
  });

  it('下一次按下解除屏蔽，单击恢复；没有手势时移动、取消、松手都不改变状态', () => {
    const suppressed = releaseBox(drag(at(20)), at(20)).gesture;

    const pressed = pressBox(START);
    expect(acceptsClick(releaseBox(pressed, START).gesture)).toBe(true);

    expect(moveBox(suppressed, at(50))).toBe(suppressed);
    expect(cancelBox(suppressed)).toBe(suppressed);
    expect(releaseBox(suppressed, at(50)).gesture).toBe(suppressed);
    expect(cancelBox(NO_BOX_GESTURE)).toBe(NO_BOX_GESTURE);
  });

  it('按下还没松手时收到的单击不算正常单击', () => {
    expect(acceptsClick(pressBox(START))).toBe(false);
    expect(acceptsClick(drag(at(20)))).toBe(false);
  });
});
