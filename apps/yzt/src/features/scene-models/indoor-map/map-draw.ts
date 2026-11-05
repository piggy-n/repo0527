import type { PlaneRaster } from './indoor-map';

// 小地图、完整地图共用的绘制（ADR 0087）：坐标换算由调用方做，这里只管画

/** 人和定位圈的颜色：主色、描边，由组件从 CSS 令牌读出 */
export interface MarkerColors {
  readonly player: string;
  readonly outline: string;
}

/** 点击移动的落点：和三维里的落点光环同色（按数据画的颜色，见 docs/design/color-and-typography.md） */
export const TARGET_COLOR = '#3cd2ff';

/** 从元素读出主色和容器底色（令牌），给画布用 */
export function markerColors(element: Element): MarkerColors {
  const style = getComputedStyle(element);
  return {
    player: style.getPropertyValue('--color-primary').trim(),
    outline: style.getPropertyValue('--color-bg-container').trim()
  };
}

/** 六位十六进制的颜色加上透明度（令牌是 #rrggbb）；别的写法原样返回 */
export function withAlpha(color: string, alpha: number): string {
  if (!/^#[\da-f]{6}$/i.test(color)) {
    return color;
  }
  return `${color}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

/** 一块平面底图转成画布，drawImage 时缩放 */
export function rasterCanvas({ image }: PlaneRaster): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (context) {
    const pixels = context.createImageData(image.width, image.height);
    pixels.data.set(image.data);
    context.putImageData(pixels, 0, 0);
  }
  return canvas;
}

/**
 * 人：视野扇形 + 箭头，箭头朝画布上方；调用方先把画布平移到人的位置、旋转到朝向。
 * size 是箭头半长、coneRadius 是扇形半径（设备像素），hfov 是水平视场角（弧度）
 */
export function drawPlayer(
  context: CanvasRenderingContext2D,
  { size, hfov, coneRadius }: { readonly size: number; readonly hfov: number; readonly coneRadius: number },
  colors: MarkerColors
): void {
  // 渐变到同一颜色的全透明：渐变到 transparent（透明的黑色）中间会发灰
  const cone = context.createRadialGradient(0, 0, 0, 0, 0, coneRadius);
  cone.addColorStop(0, colors.player);
  cone.addColorStop(1, withAlpha(colors.player, 0));
  context.save();
  context.globalAlpha = 0.4;
  context.beginPath();
  context.moveTo(0, 0);
  context.arc(0, 0, coneRadius, -Math.PI / 2 - hfov / 2, -Math.PI / 2 + hfov / 2);
  context.closePath();
  context.fillStyle = cone;
  context.fill();
  context.restore();
  context.beginPath();
  context.moveTo(0, -size);
  context.lineTo(size * 0.8, size * 0.85);
  context.lineTo(0, size * 0.4);
  context.lineTo(-size * 0.8, size * 0.85);
  context.closePath();
  context.lineJoin = 'round';
  context.lineWidth = Math.max(2, size * 0.3);
  context.strokeStyle = colors.outline;
  context.stroke();
  context.fillStyle = colors.player;
  context.fill();
}

/** 定位圈：套在人外面，地图缩得很小、看别的楼层时也找得到人的平面位置 */
export function drawLocator(context: CanvasRenderingContext2D, radius: number, colors: MarkerColors): void {
  context.save();
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.globalAlpha = 0.18;
  context.fillStyle = colors.player;
  context.fill();
  context.globalAlpha = 0.75;
  context.lineWidth = Math.max(1.5, radius / 10);
  context.strokeStyle = colors.player;
  context.stroke();
  context.restore();
}

/** 画布上的一条折线（像素） */
export type ScreenLine = readonly (readonly [x: number, y: number])[];

/**
 * 路线（ADR 0097 第 6 节）：整条是主色的细虚线，走过的一段是主色的粗实线，都先垫一层底色的描边，
 * 按区域着色的平面图上也看得清；坐标已经换成画布上的点，width 是实线的粗细
 */
export function drawRoute(
  context: CanvasRenderingContext2D,
  { all, passed }: { readonly all: readonly ScreenLine[]; readonly passed: readonly ScreenLine[] },
  width: number,
  colors: MarkerColors
): void {
  const stroke = (lines: readonly ScreenLine[], lineWidth: number, color: string) => {
    context.lineWidth = lineWidth;
    context.strokeStyle = color;
    context.beginPath();
    for (const line of lines) {
      line.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
    }
    context.stroke();
  };
  const thin = Math.max(1.5, width * 0.6);
  const casing = Math.max(2, width * 0.7);
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.setLineDash([thin * 2.5, thin * 2]);
  stroke(all, thin + casing, colors.outline);
  stroke(all, thin, colors.player);
  context.setLineDash([]);
  stroke(passed, width + casing, colors.outline);
  stroke(passed, width, colors.player);
  context.restore();
}

/** 点击移动的落点 */
export function drawTarget(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  colors: MarkerColors
): void {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = TARGET_COLOR;
  context.fill();
  context.lineWidth = Math.max(1.5, radius * 0.45);
  context.strokeStyle = colors.outline;
  context.stroke();
}
