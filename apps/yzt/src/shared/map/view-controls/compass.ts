import type { CameraState } from '@yzt/map-core';
import { visibleAngles } from '../status-bar/status-bar';

/** 指北针的提示和无障碍名称（ADR 0058）：转过时写出当前的角度，写法和状态栏一样，小角度不写成 358° */
export function compassTitle(camera: Pick<CameraState, 'bearing' | 'pitch'>): string {
  const { bearing } = visibleAngles(camera);
  const title = '指北针：恢复正北、垂直俯视';
  return bearing === null ? title : `${title}（旋转 ${bearing}°）`;
}

/** 图标要转的角度：地图顺时针转了多少，指针就逆时针转多少，总是指向地图上的正北 */
export function compassRotation(bearing: number): number {
  return bearing === 0 ? 0 : -bearing;
}
