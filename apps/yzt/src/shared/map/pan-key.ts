import type { PanModifier } from '@yzt/map-core';

/** 临时拖动地图的键（ADR 0056）：交给工具声明的修饰键，和它在提示里的写法 */
export interface PanKey {
  readonly modifier: PanModifier;
  readonly label: string;
}

// iPadOS 的 Safari 也写成 Macintosh，外接键盘时同样用 ⌘
const APPLE_PLATFORM = /Macintosh|Mac OS X|iPhone|iPad|iPod/;

/** Mac 上用 ⌘（Ctrl + 单击会被系统当成右键），其他平台用 Ctrl */
export function panKeyFor(userAgent: string): PanKey {
  return APPLE_PLATFORM.test(userAgent) ? { modifier: 'meta', label: '⌘' } : { modifier: 'ctrl', label: 'Ctrl' };
}

/** 当前浏览器的临时拖动键 */
export function currentPanKey(): PanKey {
  return panKeyFor(navigator.userAgent);
}
