import type { PanKey } from '@mx/map-tools';

/** 点/框选在鼠标旁的提示（ADR 0056 第 4 节）：临时拖动的修饰键按平台写 */
export function pickHintLines({ label }: PanKey): readonly string[] {
  return ['单击查看要素，拖动框选', `按住 ${label} 拖动地图，Esc 取消或清除结果`];
}

/** 引擎不能在三维里识别（能力 identify 为 false）时三维里的提示（ADR 0080 第 5 节）：拖动同样要按住修饰键 */
export function scenePickHintLines({ label }: PanKey): readonly string[] {
  return ['三维模式暂不支持点/框选', `切换到二维后使用，按住 ${label} 拖动地图`];
}
