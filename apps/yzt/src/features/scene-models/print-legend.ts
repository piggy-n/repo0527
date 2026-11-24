import type { PrintLegendBlock, SwatchBox } from '@/shared/map/print/print-legend';
import { MODEL_KIND_LABELS, type SceneModel } from './catalog';
import type { ModelLoadState } from './scene-content';

/**
 * 导出图片里列出的三维模型（ADR 0174）：加入了、没隐藏、没加载失败的，次序同图层。只在三维里列，二维里不画模型，由页面判断；
 * 还在加载的也列：用户不等加载完就导出时画面上有它的一部分
 */
export function printedModels(
  models: readonly SceneModel[],
  added: readonly string[],
  hidden: ReadonlySet<string>,
  stateOf: (id: string) => ModelLoadState
): SceneModel[] {
  const byId = new Map(models.map(model => [model.id, model]));
  return added.flatMap(id => {
    const model = byId.get(id);
    return model && !hidden.has(id) && stateOf(id) !== 'failed' ? [model] : [];
  });
}

// 模型的符号：一个立方体的轮廓，主色（同设计令牌 primary；图片是导出的数据，用固定的颜色）
const MODEL_COLOR = '#597ef7';

/** 在 canvas 上画模型的符号 */
export function drawModelSwatch(context: CanvasRenderingContext2D, { x, y, width, height }: SwatchBox): void {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const r = Math.min(width, height) / 2 - 1;
  const top = cy - r;
  const bottom = cy + r;
  const side = r * 0.87;
  context.save();
  context.strokeStyle = MODEL_COLOR;
  context.lineWidth = 1.5;
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(cx, top);
  context.lineTo(cx + side, cy - r / 2);
  context.lineTo(cx + side, cy + r / 2);
  context.lineTo(cx, bottom);
  context.lineTo(cx - side, cy + r / 2);
  context.lineTo(cx - side, cy - r / 2);
  context.closePath();
  context.moveTo(cx - side, cy - r / 2);
  context.lineTo(cx, cy);
  context.lineTo(cx + side, cy - r / 2);
  context.moveTo(cx, cy);
  context.lineTo(cx, bottom);
  context.stroke();
  context.restore();
}

/** 导出图片里三维模型的一组：名称后面是种类，如"江宁片区（倾斜摄影）"；没有模型时没有 */
export function modelPrintBlock(models: readonly SceneModel[]): PrintLegendBlock | null {
  if (models.length === 0) {
    return null;
  }
  return {
    title: '三维模型',
    rows: models.map(({ name, kind }) => ({
      label: `${name}（${MODEL_KIND_LABELS[kind]}）`,
      drawSwatch: drawModelSwatch
    }))
  };
}
