// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { boundaryPrintBlock, drawBoundarySwatch } from './boundary-print';
import { boundarySwatch } from './boundary-style';

describe('boundaryPrintBlock', () => {
  it('打开的级别各一行，次序同面板；都没开、透明度为 0 时没有', () => {
    const block = boundaryPrintBlock({ visible: { province: true, city: false, county: true }, opacity: 1 });

    expect(block?.title).toBe('行政区边界');
    expect(block?.rows.map(row => row.label)).toStrictEqual(['省界', '县界']);
    expect(boundaryPrintBlock({ visible: { province: false, city: false, county: false }, opacity: 1 })).toBeNull();
    expect(boundaryPrintBlock({ visible: { province: true, city: true, county: true }, opacity: 0 })).toBeNull();
  });
});

describe('drawBoundarySwatch', () => {
  it('几条线从下到上画在框的中线上，同面板的线型；透明度乘上状态里的透明度，虚线以线宽为单位', () => {
    const strokes: unknown[][] = [];
    const context = {
      lineCap: '',
      globalAlpha: 1,
      strokeStyle: '',
      lineWidth: 0,
      save: vi.fn<() => void>(),
      restore: vi.fn<() => void>(),
      beginPath: vi.fn<() => void>(),
      setLineDash: vi.fn<(segments: number[]) => void>(),
      moveTo: vi.fn<(x: number, y: number) => void>(),
      lineTo: vi.fn<(x: number, y: number) => void>(),
      stroke() {
        strokes.push([this.strokeStyle, this.lineWidth, this.globalAlpha]);
      }
    };

    drawBoundarySwatch(context as unknown as CanvasRenderingContext2D, boundarySwatch('county'), {
      x: 10,
      y: 20,
      width: 22,
      height: 16
    }, 0.5);

    const [county] = boundarySwatch('county');
    expect(strokes).toStrictEqual([[county?.color, county?.width, (county?.opacity ?? 0) * 0.5]]);
    const dash = (county?.dasharray ?? []).map(value => value * (county?.width ?? 0));
    expect(context.setLineDash).toHaveBeenCalledWith(dash);
    expect(context.moveTo).toHaveBeenCalledWith(10 + (county?.width ?? 0) / 2, 28);
  });
});
