// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { findRegion } from '../region/region-catalog';
import { describeLocationRegion, placeLocationInfo } from './location-info';

const INFO = { width: 240, height: 120 };
const CANVAS = { width: 800, height: 600 };

describe('位置信息的位置', () => {
  it('放在图钉上方、水平居中', () => {
    expect(placeLocationInfo({ x: 400, y: 300 }, INFO, CANVAS)).toStrictEqual({ left: 280, top: 140, side: 'above' });
  });

  it('上方放不下时翻到下方，避开图钉下面的名称', () => {
    expect(placeLocationInfo({ x: 400, y: 168 }, INFO, CANVAS)).toStrictEqual({ left: 280, top: 8, side: 'above' });
    expect(placeLocationInfo({ x: 400, y: 167 }, INFO, CANVAS)).toStrictEqual({ left: 280, top: 195, side: 'below' });
  });

  it('左右不超出画布，离边缘至少 8；画布比它窄时靠左', () => {
    expect(placeLocationInfo({ x: 20, y: 300 }, INFO, CANVAS).left).toBe(8);
    expect(placeLocationInfo({ x: 790, y: 300 }, INFO, CANVAS).left).toBe(552);
    expect(placeLocationInfo({ x: 100, y: 300 }, INFO, { width: 200, height: 600 }).left).toBe(8);
  });
});

describe('所在区划的文字', () => {
  it('区县的路径、省外、判断中、失败、没有位置点', () => {
    expect(describeLocationRegion({ kind: 'ready', region: findRegion('320102') ?? null })).toBe('南京市 / 玄武区');
    expect(describeLocationRegion({ kind: 'ready', region: null })).toBe('不在江苏省内');
    expect(describeLocationRegion({ kind: 'loading' })).toBe('正在判断…');
    expect(describeLocationRegion({ kind: 'failed', error: new Error('断网') })).toBe('判断失败');
    expect(describeLocationRegion({ kind: 'none' })).toBe('-');
  });
});
