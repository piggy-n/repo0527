// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CardWheelGesture, cardStops, nearestStop } from './card-navigation';

describe('逐卡导航口径', () => {
  it('小增量累计到阈值后只消费一次，惯性尾部不会再翻页', () => {
    const gesture = new CardWheelGesture();
    expect([5, 6, 7, 15, 8, 3, 1].map((delta, index) => gesture.consume(delta, index * 40))).toEqual([
      0,
      0,
      1,
      0,
      0,
      0,
      0
    ]);
    expect(gesture.consume(18, 440)).toBe(1);
  });
  it('反向手势立即允许回退，重置后不保留旧距离', () => {
    const gesture = new CardWheelGesture();
    expect(gesture.consume(40, 0)).toBe(1);
    expect(gesture.consume(-20, 20)).toBe(-1);
    gesture.reset();
    expect(gesture.consume(10, 30)).toBe(0);
    expect(gesture.consume(8, 35)).toBe(1);
    expect(gesture.consume(Number.NaN, 40)).toBe(0);
  });
  it('末屏去重、无占位，并能从真实底部反向一步', () => {
    const stops = cardStops([0, 230, 460, 690, 920], 630);
    expect(stops).toEqual([0, 230, 460, 630]);
    expect(nearestStop(stops, 630)).toBe(3);
    expect(nearestStop(stops, 430)).toBe(2);
    expect(cardStops([0, 230], 0)).toEqual([0]);
  });
});
