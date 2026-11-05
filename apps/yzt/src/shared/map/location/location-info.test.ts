// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { findRegion } from '../region/region-catalog';
import { describeLocationRegion, placeLocationInfo } from './location-info';

const INFO = { width: 240, height: 120 };
const CANVAS = { width: 800, height: 600 };
// 没有悬浮元素时四边都是边距 16
const EDGES = { top: 16, right: 16, bottom: 16, left: 16 };

describe('位置信息的位置', () => {
  it('放在图钉上方、水平居中，小三角在中间', () => {
    expect(placeLocationInfo({ x: 400, y: 300 }, INFO, CANVAS, EDGES)).toStrictEqual({
      left: 280,
      top: 140,
      side: 'above',
      caret: 120
    });
  });

  it('上方放不下（超出可视区域的上边）时翻到下方，避开图钉下面的名称', () => {
    expect(placeLocationInfo({ x: 400, y: 176 }, INFO, CANVAS, EDGES)).toMatchObject({ top: 16, side: 'above' });
    expect(placeLocationInfo({ x: 400, y: 175 }, INFO, CANVAS, EDGES)).toMatchObject({ top: 203, side: 'below' });
    // 上边登记了工具条：可视区域从 64 开始
    const toolbar = { ...EDGES, top: 64 };
    expect(placeLocationInfo({ x: 400, y: 200 }, INFO, CANVAS, toolbar)).toMatchObject({ side: 'below' });
  });

  it('左右限制在可视区域里：避开右侧的面板；小三角仍对着图钉，最多到卡片两边留 18', () => {
    const panel = { ...EDGES, right: 352 };
    expect(placeLocationInfo({ x: 20, y: 300 }, INFO, CANVAS, EDGES)).toMatchObject({ left: 16, caret: 18 });
    expect(placeLocationInfo({ x: 790, y: 300 }, INFO, CANVAS, EDGES)).toMatchObject({ left: 544, caret: 222 });
    expect(placeLocationInfo({ x: 400, y: 300 }, INFO, CANVAS, panel)).toMatchObject({ left: 208, caret: 192 });
  });

  it('可视区域比卡片窄时靠左', () => {
    const narrow = { ...EDGES, right: 600 };
    expect(placeLocationInfo({ x: 100, y: 300 }, INFO, CANVAS, narrow).left).toBe(16);
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
