import { describe, expect, it } from 'vitest';
import type { PanModifier } from '../tool/tool-model';
import type { MapPointerEvent } from '../view/view-input';
import { ModifierPan } from './modifier-pan';

// 画布在画布容器里，挂到文档上：指针事件冒泡到文档，和真实页面一样
function setup(initial: PanModifier | null = 'ctrl') {
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  container.append(canvas);
  document.body.append(container);
  // MapLibre 在画布容器的冒泡阶段收到按下
  const engineDowns: MouseEvent[] = [];
  container.addEventListener('mousedown', event => engineDowns.push(event));
  const pans: unknown[][] = [];
  const errors: unknown[] = [];
  let modifier = initial;
  let cursorChanges = 0;
  let panFailure: Error | null = null;
  const pan = new ModifierPan({
    map: {
      getCanvasContainer: () => container,
      panBy: (...args) => {
        if (panFailure !== null) {
          throw panFailure;
        }
        pans.push(args);
      }
    },
    modifier: () => modifier,
    onCursorChange: () => cursorChanges++,
    guard: callback => {
      try {
        callback();
      } catch (error) {
        errors.push(error);
      }
    }
  });
  return {
    pan,
    canvas,
    engineDowns,
    pans,
    errors,
    get cursorChanges() {
      return cursorChanges;
    },
    setModifier(value: PanModifier | null) {
      modifier = value;
    },
    failPanWith(error: Error) {
      panFailure = error;
    },
    [Symbol.dispose]() {
      pan[Symbol.dispose]();
      container.remove();
    }
  };
}

function press(target: EventTarget, init: MouseEventInit = {}): void {
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init }));
}

// 默认按着左键移动
function move(target: EventTarget, clientX: number, clientY: number, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX, clientY, buttons: 1, ...init });
  target.dispatchEvent(event);
  return event;
}

function release(target: EventTarget, init: MouseEventInit = {}): void {
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ...init }));
}

function key(type: 'keydown' | 'keyup', init: KeyboardEventInit): void {
  document.dispatchEvent(new KeyboardEvent(type, { bubbles: true, ...init }));
}

const POINTER_TYPES: readonly MapPointerEvent['type'][] = ['down', 'move', 'up', 'click', 'dblclick', 'leave'];

describe('ModifierPan', () => {
  it('takes over a left press made with the modifier held and pans by the pointer movement until release', () => {
    using ctx = setup();

    press(ctx.canvas, { ctrlKey: true, clientX: 100, clientY: 100 });
    const moved = move(ctx.canvas, 110, 95, { ctrlKey: true });
    // 松开 Ctrl、移出画布之后照样拖动
    move(document.body, 130, 95);
    move(document.body, 130, 95);
    release(document.body);
    move(ctx.canvas, 200, 200);

    // MapLibre 收不到这次按下：不旋转、不俯仰
    expect(ctx.engineDowns).toStrictEqual([]);
    expect(moved.defaultPrevented).toBe(true);
    // 地图内容跟着指针走，视野反向移动；没有位移时不平移
    expect(ctx.pans).toStrictEqual([
      [[-10, 5], { animate: false }, { cause: 'user' }],
      [[-20, 0], { animate: false }, { cause: 'user' }]
    ]);
  });

  it('leaves other presses to MapLibre and does not pan', () => {
    using ctx = setup();

    press(ctx.canvas, { clientX: 1, clientY: 1 });
    release(ctx.canvas);
    press(ctx.canvas, { button: 2, ctrlKey: true });
    press(ctx.canvas, { metaKey: true });
    // 工具没有声明修饰键，或视图没有就绪
    ctx.setModifier(null);
    press(ctx.canvas, { ctrlKey: true });
    move(ctx.canvas, 50, 50, { ctrlKey: true });

    expect(ctx.engineDowns).toHaveLength(4);
    expect(ctx.pans).toStrictEqual([]);
  });

  it('uses ⌘ when the modifier is meta', () => {
    using ctx = setup('meta');

    press(ctx.canvas, { ctrlKey: true });
    release(ctx.canvas);
    press(ctx.canvas, { metaKey: true, clientX: 0, clientY: 0 });
    move(ctx.canvas, 5, 5, { metaKey: true });

    expect(ctx.engineDowns).toHaveLength(1);
    expect(ctx.pans).toStrictEqual([[[-5, -5], { animate: false }, { cause: 'user' }]]);
  });

  it('ends the pan when the button was released outside the window, the modifier is withdrawn, on cancel and on blur', () => {
    using ctx = setup();
    const endings: (() => void)[] = [
      // 在窗口外松开时收不到 mouseup
      () => move(ctx.canvas, 1, 1, { buttons: 0 }),
      () => ctx.setModifier(null),
      () => ctx.pan.cancel(),
      () => window.dispatchEvent(new FocusEvent('blur'))
    ];

    for (const end of endings) {
      ctx.setModifier('ctrl');
      press(ctx.canvas, { ctrlKey: true, clientX: 0, clientY: 0 });
      end();
      move(ctx.canvas, 30, 30);
      release(ctx.canvas);
    }

    expect(ctx.pans).toStrictEqual([]);
  });

  it('swallows the release and clicks derived from a pan until the next press', () => {
    using ctx = setup();
    const swallowed = () => POINTER_TYPES.filter(type => ctx.pan.swallows(type));
    expect(swallowed()).toStrictEqual([]);

    press(ctx.canvas, { ctrlKey: true });
    expect(swallowed()).toStrictEqual(['up', 'click', 'dblclick']);
    release(ctx.canvas);
    expect(swallowed()).toStrictEqual(['up', 'click', 'dblclick']);

    press(ctx.canvas);
    expect(swallowed()).toStrictEqual([]);
  });

  it('shows grab while the modifier is held and grabbing while panning, telling only on changes', () => {
    using ctx = setup();
    expect(ctx.pan.cursor('crosshair')).toBe('crosshair');
    expect(ctx.pan.cursor(undefined)).toBe('');

    // 按住时自动重复的 keydown 不重复通知
    key('keydown', { key: 'Control', ctrlKey: true });
    key('keydown', { key: 'Control', ctrlKey: true });
    expect(ctx.pan.cursor('crosshair')).toBe('grab');
    press(ctx.canvas, { ctrlKey: true });
    expect(ctx.pan.cursor('crosshair')).toBe('grabbing');
    release(ctx.canvas, { ctrlKey: true });
    expect(ctx.pan.cursor('crosshair')).toBe('grab');
    key('keyup', { key: 'Control' });
    expect(ctx.pan.cursor('crosshair')).toBe('crosshair');
    // 指针事件也带着修饰键（例如页面没有焦点时按下的 Ctrl）
    move(ctx.canvas, 0, 0, { ctrlKey: true, buttons: 0 });
    expect(ctx.pan.cursor('crosshair')).toBe('grab');
    window.dispatchEvent(new FocusEvent('blur'));
    expect(ctx.pan.cursor('crosshair')).toBe('crosshair');

    expect(ctx.cursorChanges).toBe(6);
  });

  it('keeps the tool cursor while another left press, such as a box select, is going on', () => {
    using ctx = setup();

    press(ctx.canvas);
    key('keydown', { key: 'Control', ctrlKey: true });
    expect(ctx.pan.cursor('crosshair')).toBe('crosshair');
    release(ctx.canvas, { ctrlKey: true });
    expect(ctx.pan.cursor('crosshair')).toBe('grab');

    // 在窗口外松开时，下一次移动按 buttons 知道左键已经松开
    key('keyup', { key: 'Control' });
    press(ctx.canvas);
    move(document.body, 0, 0, { ctrlKey: true, buttons: 0 });
    expect(ctx.pan.cursor('crosshair')).toBe('grab');
  });

  it('only shows the grab cursor for the modifier the active tool declares', () => {
    using ctx = setup(null);
    key('keydown', { key: 'Control', ctrlKey: true });
    expect(ctx.pan.cursor('crosshair')).toBe('crosshair');

    ctx.setModifier('meta');
    expect(ctx.pan.cursor('crosshair')).toBe('crosshair');
    ctx.setModifier('ctrl');
    expect(ctx.pan.cursor('crosshair')).toBe('grab');
  });

  it('passes errors to guard instead of throwing them into the DOM event', () => {
    using ctx = setup();
    const failure = new Error('pan failed');
    ctx.failPanWith(failure);

    press(ctx.canvas, { ctrlKey: true, clientX: 0, clientY: 0 });
    move(ctx.canvas, 10, 0);

    expect(ctx.errors).toStrictEqual([failure]);
  });

  it('stops listening once disposed', () => {
    using ctx = setup();
    ctx.pan[Symbol.dispose]();

    key('keydown', { key: 'Control', ctrlKey: true });
    press(ctx.canvas, { ctrlKey: true, clientX: 0, clientY: 0 });
    move(ctx.canvas, 10, 10);

    expect(ctx.cursorChanges).toBe(0);
    expect(ctx.engineDowns).toHaveLength(1);
    expect(ctx.pans).toStrictEqual([]);
  });
});
