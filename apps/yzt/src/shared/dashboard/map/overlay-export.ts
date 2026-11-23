import { loadIconImage } from '../../icons/icon-image';
import type { ExportPart } from './export-parts';
import { SCALE_UNIT_GAP, scaleBar } from './scale-bar';

// 指北针和比例尺在导出图片里的画法，样式与 overlay.module.scss 一致（取 --ui-scale 为 1 时的值）

const INK = '#0E4894';
const SCALE_FONT = '400 14px "Alibaba PuHuiTi", sans-serif';
// 刻度文字一行的高度（14 像素 × 行高 1.4）、文字和色带的间距、色带连上下边框的高度
const SCALE_LINE = 19.6;
const SCALE_ROW_GAP = 2;
const SCALE_TRACK = 8;

// 阴影的模糊和偏移不随画布缩放，按当前缩放换算成 CSS 像素
function shadow(context: CanvasRenderingContext2D, color: string, blur: number, offsetY: number): void {
  const ratio = context.getTransform().a;
  context.shadowColor = color;
  context.shadowBlur = blur * ratio;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = offsetY * ratio;
}

/** 比例尺在导出图片里的画法：点下载时的比例，按留给它的宽度选长度，选法与页面相同 */
export function scaleBarExportPart(metersPerPixel: number): ExportPart {
  return {
    layout(context, room) {
      context.font = SCALE_FONT;
      const measure = (text: string) => context.measureText(text).width;
      const bar = scaleBar(metersPerPixel, room.width, measure);
      const height = SCALE_LINE + SCALE_ROW_GAP + SCALE_TRACK;
      if (!bar || height > room.height) {
        return null;
      }
      // 左端"0"的一半伸到比例尺外面，单位跟在最后一个刻度文字后面
      const left = measure('0') / 2;
      const unitX = left + bar.width + measure(String(bar.length)) / 2 + SCALE_UNIT_GAP;
      return {
        width: unitX + measure(bar.unit),
        height,
        draw(target, x, y) {
          const start = x + left;
          const middle = y + SCALE_LINE / 2;
          const trackTop = y + SCALE_LINE + SCALE_ROW_GAP;
          target.save();
          target.font = SCALE_FONT;
          target.fillStyle = INK;
          target.textBaseline = 'middle';
          shadow(target, 'rgba(255, 255, 255, 0.9)', 2, 1);
          target.textAlign = 'center';
          bar.ticks.forEach(tick => {
            if (tick.label !== null) {
              target.fillText(tick.label, start + tick.offset, middle);
            }
          });
          target.textAlign = 'left';
          target.fillText(bar.unit, x + unitX, middle);
          // 色带：白底带阴影，第一、三段深蓝，外面一圈深蓝边框
          shadow(target, 'rgba(14, 72, 148, 0.18)', 3, 1);
          target.fillStyle = '#FFFFFF';
          target.fillRect(start, trackTop, bar.width, SCALE_TRACK);
          target.shadowColor = 'transparent';
          target.fillStyle = INK;
          target.fillRect(start, trackTop, bar.width / 4, SCALE_TRACK);
          target.fillRect(start + bar.width / 2, trackTop, bar.width / 4, SCALE_TRACK);
          target.strokeStyle = INK;
          target.lineWidth = 1;
          target.strokeRect(start + 0.5, trackTop + 0.5, bar.width - 1, SCALE_TRACK - 1);
          target.restore();
        }
      };
    }
  };
}

/** 指北针在导出图片里的画法：点下载时的朝向，填满留给它的方块 */
export async function compassExportPart(rotation: number): Promise<ExportPart> {
  // 比导出里画的 96 像素（48 × 2 倍）大一些解码，转动、缩小后也清楚
  const image = await loadIconImage('dashboard-compass-color', 128).catch(() => {
    throw new Error('指北针图片加载失败，请重试');
  });
  return {
    layout(_context, room) {
      const size = Math.min(room.width, room.height);
      if (size <= 0) {
        return null;
      }
      return {
        width: size,
        height: size,
        draw(target, x, y) {
          const radius = size / 2;
          target.save();
          target.translate(x + radius, y + radius);
          // 圆形的投影，与页面上 .compass 的 box-shadow 一致
          shadow(target, 'rgba(14, 72, 148, 0.18)', 8, 2);
          target.fillStyle = '#FFFFFF';
          target.beginPath();
          target.arc(0, 0, radius, 0, Math.PI * 2);
          target.fill();
          target.shadowColor = 'transparent';
          target.rotate(rotation * Math.PI / 180);
          target.drawImage(image, -radius, -radius, size, size);
          target.restore();
        }
      };
    }
  };
}
