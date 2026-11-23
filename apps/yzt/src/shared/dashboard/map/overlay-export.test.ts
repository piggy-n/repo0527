// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { scaleBarExportPart } from './overlay-export';

// 每个字符 7 像素（同 scale-bar.test.ts），画布按 2 倍缩放；记录写字、填充矩形和阴影
function recordingContext() {
  const texts: { text: string; x: number; y: number; align: string }[] = [];
  const rects: { x: number; y: number; width: number; height: number; color: string }[] = [];
  const blurs: number[] = [];
  const context = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'start',
    textBaseline: 'alphabetic',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    measureText: (text: string) => ({ width: text.length * 7 }),
    getTransform: () => ({ a: 2 }),
    save() {
    },
    restore() {
    },
    strokeRect() {
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, align: context.textAlign });
      blurs.push(context.shadowBlur);
    },
    fillRect(x: number, y: number, width: number, height: number) {
      rects.push({ x, y, width, height, color: context.fillStyle });
    }
  };
  return { context: context as unknown as CanvasRenderingContext2D, texts, rects, blurs };
}

describe('导出图片里的比例尺', () => {
  it('按留给它的宽度选长度，整体宽度算上两端伸出去的文字和单位，与页面的选法相同', () => {
    const { context } = recordingContext();
    // 同 scale-bar.test.ts：1000 米每像素、宽 152 时是 120 千米
    const placed = scaleBarExportPart(1000).layout(context, { width: 152, height: Number.POSITIVE_INFINITY });
    expect(placed).toMatchObject({ width: 152, height: 19.6 + 2 + 8 });
    expect(scaleBarExportPart(1000).layout(context, { width: 151.9, height: 100 })?.width).toBe(132);
  });

  it('刻度文字以刻度为中心写在色带上方，单位跟在最后一个文字后面；色带第一、三段深蓝', () => {
    const { context, texts, rects, blurs } = recordingContext();
    const placed = scaleBarExportPart(1000).layout(context, { width: 152, height: 100 });
    placed?.draw(context, 10, 20);
    // 左端"0"的一半 3.5 伸在外面
    const start = 13.5;
    const middle = 20 + 19.6 / 2;
    expect(texts).toEqual([
      ...[0, 30, 60, 90, 120].map(offset => ({ text: String(offset), x: start + offset, y: middle, align: 'center' })),
      { text: '千米', x: start + 120 + 10.5 + 4, y: middle, align: 'left' }
    ]);
    const trackTop = 20 + 19.6 + 2;
    expect(rects).toEqual([
      { x: start, y: trackTop, width: 120, height: 8, color: '#FFFFFF' },
      { x: start, y: trackTop, width: 30, height: 8, color: '#0E4894' },
      { x: start + 60, y: trackTop, width: 30, height: 8, color: '#0E4894' }
    ]);
    // 阴影的模糊不随画布缩放，按 2 倍换算
    expect(blurs).toEqual(texts.map(() => 4));
  });

  it('比例算不出来、放不下或高度不够时不画', () => {
    const { context } = recordingContext();
    expect(scaleBarExportPart(Number.NaN).layout(context, { width: 220, height: 100 })).toBeNull();
    expect(scaleBarExportPart(1000).layout(context, { width: 10, height: 100 })).toBeNull();
    expect(scaleBarExportPart(1000).layout(context, { width: 220, height: 20 })).toBeNull();
  });
});
