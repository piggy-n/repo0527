import { describe, expect, it } from 'vitest';
import { CesiumDrag } from './cesium-drag';
import type { ClientPoint } from './modifier-pan';

const LEFT = 0;
const MIDDLE = 1;
const RIGHT = 2;
// MouseEvent.buttons 里的位
const FLAGS = { [LEFT]: 1, [MIDDLE]: 4, [RIGHT]: 2 } as const;

// 画布在画布容器里，挂到文档上：指针事件冒泡到文档，和真实页面一样
function setup() {
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  container.append(canvas);
  document.body.append(container);
  // 引擎（MapLibre）在画布容器的冒泡阶段收到按下
  const engineDowns: MouseEvent[] = [];
  container.addEventListener('mousedown', event => engineDowns.push(event));
  const zooms: (readonly [number, ClientPoint])[] = [];
  const rotations: (readonly [number, number])[] = [];
  const errors: unknown[] = [];
  let active = true;
  let ctrlRotates = true;
  let zoomFailure: Error | null = null;
  const drag = new CesiumDrag({
    container,
    active: () => active,
    ctrlRotates: () => ctrlRotates,
    zoom: (delta, around) => {
      if (zoomFailure !== null) {
        throw zoomFailure;
      }
      zooms.push([delta, around]);
    },
    rotate: (bearing, pitch) => rotations.push([bearing, pitch]),
    guard: callback => {
      try {
        callback();
      } catch (error) {
        errors.push(error);
      }
    }
  });
  return {
    drag,
    canvas,
    engineDowns,
    zooms,
    rotations,
    errors,
    setActive(value: boolean) {
      active = value;
    },
    setCtrlRotates(value: boolean) {
      ctrlRotates = value;
    },
    failZoomWith(error: Error | null) {
      zoomFailure = error;
    },
    [Symbol.dispose]() {
      drag[Symbol.dispose]();
      container.remove();
    }
  };
}

type Button = typeof LEFT | typeof MIDDLE | typeof RIGHT;

function press(target: EventTarget, button: Button, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    button,
    buttons: FLAGS[button],
    clientX: 100,
    clientY: 100,
    ...init
  });
  target.dispatchEvent(event);
  return event;
}

function move(button: Button, clientX: number, clientY: number, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('mousemove', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    buttons: FLAGS[button],
    ...init
  });
  document.dispatchEvent(event);
  return event;
}

function release(button: Button): void {
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button }));
}

function contextMenu(target: EventTarget): MouseEvent {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: RIGHT });
  target.dispatchEvent(event);
  return event;
}

describe('CesiumDrag（ADR 0168）', () => {
  it('右键拖缩放：往下拖放大、往上拖缩小，每 100 像素一级，围着按下的位置；引擎收不到这次按下', () => {
    using env = setup();
    press(env.canvas, RIGHT);
    move(RIGHT, 100, 150);
    move(RIGHT, 100, 130);
    release(RIGHT);
    expect(env.zooms).toStrictEqual([
      [0.5, { x: 100, y: 100 }],
      [-0.2, { x: 100, y: 100 }]
    ]);
    expect(env.rotations).toStrictEqual([]);
    expect(env.engineDowns).toStrictEqual([]);

    // 松开以后不再缩放
    move(RIGHT, 100, 200);
    expect(env.zooms).toHaveLength(2);
  });

  it('中键拖、Ctrl + 左键拖旋转和倾斜：速率同 MapLibre 的右键拖；中键不触发浏览器的自动滚动', () => {
    using env = setup();
    const middle = press(env.canvas, MIDDLE);
    expect(middle.defaultPrevented).toBe(true);
    move(MIDDLE, 110, 80);
    release(MIDDLE);
    press(env.canvas, LEFT, { ctrlKey: true });
    move(LEFT, 90, 104, { ctrlKey: true });
    release(LEFT);
    expect(env.rotations).toStrictEqual([
      [8, 10],
      [-8, -2]
    ]);
    expect(env.zooms).toStrictEqual([]);
    expect(env.engineDowns).toStrictEqual([]);
  });

  it('移动不到 3 像素不算拖动；之后从按下的位置算起', () => {
    using env = setup();
    press(env.canvas, RIGHT);
    move(RIGHT, 101, 102);
    expect(env.zooms).toStrictEqual([]);
    move(RIGHT, 100, 110);
    expect(env.zooms).toStrictEqual([[0.1, { x: 100, y: 100 }]]);
  });

  it('左键拖、Shift + 左键照旧交给引擎；当前工具把 Ctrl 用作临时拖动时 Ctrl + 左键也交给它', () => {
    using env = setup();
    press(env.canvas, LEFT);
    press(env.canvas, LEFT, { shiftKey: true });
    env.setCtrlRotates(false);
    press(env.canvas, LEFT, { ctrlKey: true });
    move(LEFT, 120, 120, { ctrlKey: true });
    expect(env.engineDowns).toHaveLength(3);
    expect(env.rotations).toStrictEqual([]);
  });

  it('不按 Cesium 式时什么也不截：右键交给引擎，右键菜单照常', () => {
    using env = setup();
    env.setActive(false);
    press(env.canvas, RIGHT);
    move(RIGHT, 100, 150);
    expect(env.engineDowns).toHaveLength(1);
    expect(env.zooms).toStrictEqual([]);
    expect(contextMenu(env.canvas).defaultPrevented).toBe(false);
  });

  it('按 Cesium 式时地图上没有浏览器的右键菜单', () => {
    using env = setup();
    expect(contextMenu(env.canvas).defaultPrevented).toBe(true);
  });

  it('拖动中途不再按 Cesium 式（换了种类、漫游接管）、在窗口外松开、cancel、窗口失焦都结束这次拖动', () => {
    using env = setup();
    press(env.canvas, RIGHT);
    move(RIGHT, 100, 150);
    env.setActive(false);
    move(RIGHT, 100, 200);
    env.setActive(true);
    move(RIGHT, 100, 250);
    expect(env.zooms).toHaveLength(1);

    press(env.canvas, RIGHT);
    move(RIGHT, 100, 150, { buttons: 0 });
    move(RIGHT, 100, 200);
    expect(env.zooms).toHaveLength(1);

    press(env.canvas, MIDDLE);
    env.drag.cancel();
    move(MIDDLE, 150, 100);
    press(env.canvas, MIDDLE);
    window.dispatchEvent(new Event('blur'));
    move(MIDDLE, 150, 100);
    expect(env.rotations).toStrictEqual([]);
  });

  it('拖动期间又来的按下一并截下，引擎收不到', () => {
    using env = setup();
    press(env.canvas, RIGHT);
    press(env.canvas, LEFT, { buttons: 3 });
    expect(env.engineDowns).toStrictEqual([]);
  });

  it('回调抛错交给 guard，不打断这次拖动；释放后不再监听', () => {
    using env = setup();
    env.failZoomWith(new Error('缩放失败'));
    press(env.canvas, RIGHT);
    move(RIGHT, 100, 150);
    expect(env.errors).toStrictEqual([new Error('缩放失败')]);
    env.failZoomWith(null);
    move(RIGHT, 100, 160);
    expect(env.zooms).toStrictEqual([[0.1, { x: 100, y: 100 }]]);
    release(RIGHT);

    env.drag[Symbol.dispose]();
    press(env.canvas, RIGHT);
    move(RIGHT, 100, 200);
    expect(env.zooms).toHaveLength(1);
    expect(env.engineDowns).toHaveLength(1);
    expect(contextMenu(env.canvas).defaultPrevented).toBe(false);
  });
});
