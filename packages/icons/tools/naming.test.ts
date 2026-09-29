import { describe, expect, it } from 'vitest';
import { isMulticolor, toIconName } from './naming.ts';

describe('toIconName', () => {
  it.each([
    ['user', 'user'],
    ['userAvatar', 'user-avatar'],
    ['UserAvatar', 'user-avatar'],
    ['map_layer', 'map-layer'],
    ['Map Layer', 'map-layer'],
    ['icon.close', 'icon-close'],
    ['SVGIcon', 'svg-icon'],
    ['arrow--left_', 'arrow-left'],
    ['icon2x', 'icon2x'],
    ['Logo Color-color', 'logo-color-color']
  ])('%s → %s', (input, expected) => {
    expect(toIconName(input)).toBe(expected);
  });

  it.each(['图层', '地图layer', 'icon@2x', ''])('无法转换时返回 undefined：%s', input => {
    expect(toIconName(input)).toBeUndefined();
  });
});

describe('isMulticolor', () => {
  it('以 -color 结尾的是多色图标', () => {
    expect(isMulticolor('logo-color')).toBe(true);
    expect(isMulticolor('color-picker')).toBe(false);
  });
});
