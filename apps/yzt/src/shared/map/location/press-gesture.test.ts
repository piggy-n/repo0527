// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPressGesture, type PressGestureHandlers, type PressPhase } from './press-gesture';

function setup() {
  const phases: PressPhase[] = [];
  const handlers = {
    onPhase: (phase: PressPhase) => void phases.push(phase),
    onClick: vi.fn<PressGestureHandlers['onClick']>(),
    onDragMove: vi.fn<PressGestureHandlers['onDragMove']>(),
    onDragEnd: vi.fn<PressGestureHandlers['onDragEnd']>(),
    onDragCancel: vi.fn<PressGestureHandlers['onDragCancel']>()
  };
  const gesture = createPressGesture(handlers);
  return { gesture, phases, ...handlers };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('图钉上的按下手势', () => {
  it('没到 0.5 秒就松开是单击', () => {
    const { gesture, phases, onClick, onDragEnd } = setup();

    gesture.down({ x: 10, y: 10 });
    vi.advanceTimersByTime(499);
    gesture.up();

    expect(onClick).toHaveBeenCalledOnce();
    expect(onDragEnd).not.toHaveBeenCalled();
    expect(phases).toStrictEqual(['pressing', 'idle']);
    vi.advanceTimersByTime(1000);
    expect(gesture.phase).toBe('idle');
  });

  it('按住 0.5 秒进入拖动：移动时给出位置，松开时结束，不算单击', () => {
    const { gesture, phases, onClick, onDragMove, onDragEnd } = setup();

    gesture.down({ x: 10, y: 10 });
    vi.advanceTimersByTime(500);
    expect(gesture.phase).toBe('dragging');
    gesture.move({ x: 60, y: 80 });
    gesture.up();

    expect(onDragMove.mock.calls).toStrictEqual([[{ x: 60, y: 80 }]]);
    expect(onDragEnd).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
    expect(phases).toStrictEqual(['pressing', 'dragging', 'idle']);
  });

  it('按住时移动不超过 4 像素照常计时；超过时取消，不单击、不拖动', () => {
    const steady = setup();
    const moved = setup();

    steady.gesture.down({ x: 10, y: 10 });
    steady.gesture.move({ x: 13, y: 10 });
    vi.advanceTimersByTime(500);
    moved.gesture.down({ x: 10, y: 10 });
    moved.gesture.move({ x: 13, y: 13.5 });
    vi.advanceTimersByTime(500);
    moved.gesture.up();

    expect(steady.gesture.phase).toBe('dragging');
    expect(moved.phases).toStrictEqual(['pressing', 'idle']);
    expect(moved.onClick).not.toHaveBeenCalled();
    expect(moved.onDragMove).not.toHaveBeenCalled();
  });

  it('拖动中取消（Esc 或指针被取消）时回到原位；按住时取消什么也不做', () => {
    const dragging = setup();
    const pressing = setup();

    dragging.gesture.down({ x: 10, y: 10 });
    vi.advanceTimersByTime(500);
    dragging.gesture.cancel();
    dragging.gesture.up();
    pressing.gesture.down({ x: 10, y: 10 });
    pressing.gesture.cancel();
    pressing.gesture.up();
    vi.advanceTimersByTime(500);

    expect(dragging.onDragCancel).toHaveBeenCalledOnce();
    expect(dragging.onDragEnd).not.toHaveBeenCalled();
    expect(pressing.phases).toStrictEqual(['pressing', 'idle']);
    expect(pressing.onClick).not.toHaveBeenCalled();
  });

  it('按下后再次按下不重新开始；没按下时移动、松开、取消都不起作用', () => {
    const { gesture, phases, onClick, onDragMove, onDragCancel } = setup();

    gesture.move({ x: 1, y: 1 });
    gesture.up();
    gesture.cancel();
    gesture.down({ x: 10, y: 10 });
    vi.advanceTimersByTime(300);
    gesture.down({ x: 20, y: 20 });
    vi.advanceTimersByTime(200);

    expect(gesture.phase).toBe('dragging');
    expect(phases).toStrictEqual(['pressing', 'dragging']);
    expect(onClick).not.toHaveBeenCalled();
    expect(onDragMove).not.toHaveBeenCalled();
    expect(onDragCancel).not.toHaveBeenCalled();
  });

  it('释放后计时停止，不再进入拖动', () => {
    const { gesture, phases } = setup();

    gesture.down({ x: 10, y: 10 });
    gesture[Symbol.dispose]();
    vi.advanceTimersByTime(1000);

    expect(gesture.phase).toBe('idle');
    expect(phases).toStrictEqual(['pressing']);
  });
});
