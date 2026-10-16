import type { PanKey } from '@/shared/map/pan-key';

/** 点/框选在鼠标旁的提示（ADR 0056 第 4 节）：临时拖动的修饰键按平台写 */
export function pickHintLines({ label }: PanKey): readonly string[] {
  return ['单击查看要素，拖动框选', `按住 ${label} 拖动地图，Esc 取消或清除结果`];
}
