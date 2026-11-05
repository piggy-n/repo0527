import type { ScreenPoint } from '@yzt/map-core';

/** 按住多久进入拖动、按住时移动多少像素算取消（ADR 0037 第 5 条） */
export const LONG_PRESS_DELAY = 500;
export const PRESS_TOLERANCE = 4;

/** 按下后的阶段：按住中（进度在走）、拖动中 */
export type PressPhase = 'idle' | 'pressing' | 'dragging';

export interface PressGestureHandlers {
  readonly onPhase: (phase: PressPhase) => void;
  /** 按下后没到时间就松开、也没移动：单击 */
  readonly onClick: () => void;
  readonly onDragMove: (point: ScreenPoint) => void;
  readonly onDragEnd: () => void;
  /** 拖动中按 Esc 或指针被浏览器取消：回到原位 */
  readonly onDragCancel: () => void;
}

export interface PressGesture extends Disposable {
  down(point: ScreenPoint): void;
  move(point: ScreenPoint): void;
  up(): void;
  /** Esc 或指针被取消 */
  cancel(): void;
  readonly phase: PressPhase;
}

/**
 * 图钉上的单击与长按拖动（与 DOM 无关的状态机）：按下后 0.5 秒内松开是单击；
 * 到时间进入拖动；还没到时间就移动超过 4 像素时取消，什么也不做
 */
export function createPressGesture(handlers: PressGestureHandlers): PressGesture {
  let phase: PressPhase = 'idle';
  let start: ScreenPoint = { x: 0, y: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;

  const setPhase = (next: PressPhase) => {
    clearTimeout(timer);
    timer = undefined;
    phase = next;
    handlers.onPhase(next);
  };

  return {
    get phase() {
      return phase;
    },
    down(point) {
      if (phase !== 'idle') {
        return;
      }
      start = point;
      setPhase('pressing');
      timer = setTimeout(() => setPhase('dragging'), LONG_PRESS_DELAY);
    },
    move(point) {
      if (phase === 'dragging') {
        handlers.onDragMove(point);
      } else if (phase === 'pressing' && Math.hypot(point.x - start.x, point.y - start.y) > PRESS_TOLERANCE) {
        setPhase('idle');
      }
    },
    up() {
      if (phase === 'pressing') {
        setPhase('idle');
        handlers.onClick();
      } else if (phase === 'dragging') {
        setPhase('idle');
        handlers.onDragEnd();
      }
    },
    cancel() {
      if (phase === 'dragging') {
        setPhase('idle');
        handlers.onDragCancel();
      } else if (phase === 'pressing') {
        setPhase('idle');
      }
    },
    [Symbol.dispose]() {
      clearTimeout(timer);
      phase = 'idle';
    }
  };
}
