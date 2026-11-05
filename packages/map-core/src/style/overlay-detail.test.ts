// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { overlayDetailLimit, overlayDetailMetadata } from './overlay-detail';

describe('overlayDetailLimit', () => {
  it('读出 overlayDetailMetadata 写的级别', () => {
    expect(overlayDetailLimit(overlayDetailMetadata(11))).toBe(11);
  });

  it.each([
    ['没有 metadata', undefined],
    ['null', null],
    ['不是对象', 11],
    ['别的键', { 'mapbox:group': 'x' }],
    ['值不是数字', { 'yzt:overlay-detail-level': '11' }],
    ['值不是有限数', { 'yzt:overlay-detail-level': Number.POSITIVE_INFINITY }]
  ])('%s 时没有上限', (_, metadata) => {
    expect(overlayDetailLimit(metadata)).toBeNull();
  });
});
