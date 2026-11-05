import { useEventListener } from '@vueuse/core';

// 按下到松开移动超过这么多像素算拖动：拖地图是在看效果，不算点了外部
const DRAG_TOLERANCE = 4;

export interface LightDismissOptions {
  /** 浮层正在显示时才监听 */
  readonly active: () => boolean;
  /** 目标属于浮层或它的入口 */
  readonly contains: (target: Node) => boolean;
  /** 单击了外部；这次点击照常交给被点的元素 */
  readonly onOutside: () => void;
  /** 按了 Esc；这次按键不再往下传，当前工具不会同时结束 */
  readonly onEscape: () => void;
}

/**
 * 浮层的轻量关闭（ADR 0146）：单击外部、按 Esc。在捕获阶段监听，地图的事件处理拦不住；
 * 按键触发的点击没有按下事件，也算点击，所以点外部要看 click，不看 pointerup
 */
export function useLightDismiss({ active, contains, onOutside, onEscape }: LightDismissOptions): void {
  let press: { readonly x: number; readonly y: number; readonly inside: boolean } | null = null;
  const target = () => (active() ? document : null);
  const isInside = (node: EventTarget | null) => node instanceof Node && contains(node);

  useEventListener(
    target,
    'pointerdown',
    (event: MouseEvent) => {
      press = { x: event.clientX, y: event.clientY, inside: isInside(event.target) };
    },
    { capture: true }
  );
  useEventListener(
    target,
    'click',
    (event: MouseEvent) => {
      // detail 为 0 是按键触发的点击，之前记下的按下和它无关
      const started = event.detail === 0 ? null : press;
      press = null;
      if (isInside(event.target)) {
        return;
      }
      // 从浮层里按下、拖到外面松手（如拖滑块）不算；浏览器这时把 click 发给共同的祖先
      const dragged = started && Math.hypot(event.clientX - started.x, event.clientY - started.y) > DRAG_TOLERANCE;
      if (started?.inside || dragged) {
        return;
      }
      onOutside();
    },
    { capture: true }
  );
  useEventListener(
    target,
    'keydown',
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscape();
      }
    },
    { capture: true }
  );
}
