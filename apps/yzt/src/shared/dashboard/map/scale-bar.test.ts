// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { scaleBar } from './scale-bar';

// 每个字符 7 像素，约是 12 像素字号的数字宽度；"千米"按 14 像素
const textWidth = (text: string) => text.length * 7;

const labels = (bar: ReturnType<typeof scaleBar>) => bar?.ticks.map(tick => tick.label);

describe('比例尺', () => {
  it('选整体宽度不超过可用宽度的最长总长度，分四段，五个刻度都写', () => {
    // 120 千米：左端"0"的一半 3.5 + 120 + "120"的一半 10.5 + 空隙 4 + "千米" 14 = 152
    const bar = scaleBar(1000, 152, textWidth);
    expect(bar).toMatchObject({ width: 120, length: 120, unit: '千米' });
    expect(bar?.ticks.map(tick => tick.offset)).toEqual([0, 30, 60, 90, 120]);
    expect(labels(bar)).toEqual(['0', '30', '60', '90', '120']);
  });

  it('整体宽度正好等于可用宽度时可以选，再窄一点就换下一个候选', () => {
    expect(scaleBar(1000, 151.9, textWidth)).toMatchObject({ length: 100, width: 100 });
    // 候选里 200 之后是 400，不是 300
    expect(scaleBar(1000, 399, textWidth)).toMatchObject({ length: 200 });
  });

  it('四分点是小数时照样写，相邻文字放不下时只写 0、L/2、L，再放不下只写两端', () => {
    expect(labels(scaleBar(250, 250, textWidth))).toEqual(['0', '12.5', '25', '37.5', '50']);
    expect(labels(scaleBar(1000, 80, textWidth))).toEqual(['0', null, '25', null, '50']);
    expect(labels(scaleBar(1000, 50, textWidth))).toEqual(['0', null, null, null, '20']);
  });

  it('1 千米都放不下时改用米', () => {
    expect(scaleBar(2, 150, textWidth)).toMatchObject({ length: 200, unit: '米', width: 100 });
    expect(scaleBar(10, 150, textWidth)).toMatchObject({ length: 1, unit: '千米', width: 100 });
  });

  it('比例算不出来、没有宽度或 1 米都放不下时不画', () => {
    expect(scaleBar(Number.NaN, 150, textWidth)).toBeNull();
    expect(scaleBar(0, 150, textWidth)).toBeNull();
    expect(scaleBar(1000, 0, textWidth)).toBeNull();
    expect(scaleBar(0.001, 150, textWidth)).toBeNull();
  });
});
