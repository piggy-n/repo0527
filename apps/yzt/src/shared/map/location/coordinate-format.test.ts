// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  type Axis,
  formatCoordinate,
  formatLngLat,
  looksSwapped,
  parseCoordinate,
  splitCoordinatePair
} from './coordinate-format';

// 识别成功时的值换成度分秒显示，便于比较
function dmsOf(text: string, axis: Axis): string {
  const result = parseCoordinate(text, axis);
  return result.ok ? formatCoordinate(result.value, 'dms') : `错误：${result.message}`;
}

function errorOf(text: string, axis: Axis) {
  const result = parseCoordinate(text, axis);
  return result.ok ? null : { reason: result.reason, message: result.message };
}

describe('坐标的识别', () => {
  it.each([
    ['118°46′40.5″', '118°46′40.50″'],
    [`118°46'40.5"`, '118°46′40.50″'],
    ["118°46'40.5''", '118°46′40.50″'],
    ['118度46分40.5秒', '118°46′40.50″'],
    ['１１８°４６′４０．５″', '118°46′40.50″'],
    ['118º46’40.5”', '118°46′40.50″'],
    ['118°46′', '118°46′00.00″'],
    ['118°40″', '118°00′40.00″'],
    ['118 46 40.5', '118°46′40.50″'],
    ['118,46,40.5', '118°46′40.50″'],
    ['118，46，40.5', '118°46′40.50″'],
    ['118 46', '118°46′00.00″'],
    ['118°46 40', '118°46′40.00″'],
    ['1184640.5', '118°46′40.50″'],
    ['1184640', '118°46′40.00″'],
    ['11846', '118°46′00.00″'],
    ['11846.5', '118°46′30.00″'],
    ['984640', '98°46′40.00″'],
    ['118.777778', '118°46′40.00″'],
    ['118', '118°00′00.00″'],
    ['  118 46 40  ', '118°46′40.00″']
  ])('经度：%s → %s', (text, expected) => {
    expect(dmsOf(text, 'lng')).toBe(expected);
  });

  it.each([
    ['32°03′23.4″', '32°03′23.40″'],
    ['320323', '32°03′23.00″'],
    ['3203', '32°03′00.00″'],
    ['32.0565', '32°03′23.40″'],
    ['32 3 23', '32°03′23.00″'],
    ['50323', '50°32′03.00″'],
    ['93023', '9°30′23.00″']
  ])('纬度：%s → %s', (text, expected) => {
    expect(dmsOf(text, 'lat')).toBe(expected);
  });

  it('方向：E、N、东经、北纬为正，W、S、西经、南纬和负号为负；写在开头或末尾、大小写都认', () => {
    expect(dmsOf('118°46′40″E', 'lng')).toBe('118°46′40.00″');
    expect(dmsOf('e118.5', 'lng')).toBe('118°30′00.00″');
    expect(dmsOf('东经118.5', 'lng')).toBe('118°30′00.00″');
    expect(dmsOf('118.5W', 'lng')).toBe('-118°30′00.00″');
    expect(dmsOf('西经 118.5', 'lng')).toBe('-118°30′00.00″');
    expect(dmsOf('-118.5', 'lng')).toBe('-118°30′00.00″');
    expect(dmsOf('－118.5', 'lng')).toBe('-118°30′00.00″');
    expect(dmsOf('北纬32.5', 'lat')).toBe('32°30′00.00″');
    expect(dmsOf('32.5s', 'lat')).toBe('-32°30′00.00″');
    expect(dmsOf('南纬 32.5', 'lat')).toBe('-32°30′00.00″');
  });

  it('方向和输入框对不上时报错', () => {
    expect(errorOf('32°03′23″N', 'lng')).toStrictEqual({ reason: 'direction', message: '这是纬度的写法，请填到纬度框' });
    expect(errorOf('东经118', 'lat')).toStrictEqual({ reason: 'direction', message: '这是经度的写法，请填到经度框' });
  });

  it('空白、认不出来的写法报错，并给出可以怎么写', () => {
    expect(errorOf('  ', 'lng')).toStrictEqual({ reason: 'empty', message: '请输入经度' });
    expect(errorOf('', 'lat')).toStrictEqual({ reason: 'empty', message: '请输入纬度' });
    const unrecognized = {
      reason: 'unrecognized',
      message: '无法识别，可以写成 118°46′40″、118 46 40 或 1184640'
    };
    expect(errorOf('abc', 'lng')).toStrictEqual(unrecognized);
    expect(errorOf('E', 'lng')).toStrictEqual(unrecognized);
    expect(errorOf('118 46 40 12', 'lng')).toStrictEqual(unrecognized);
    expect(errorOf("118°46'40\"12", 'lng')).toStrictEqual(unrecognized);
    expect(errorOf("40\"46'", 'lng')).toStrictEqual(unrecognized);
    expect(errorOf('x32', 'lat')?.message).toBe('无法识别，可以写成 32°03′23″、32 3 23 或 320323');
  });

  it('只有最后一段可以带小数；分、秒要小于 60；超出范围报错', () => {
    expect(errorOf("118.5°30'", 'lng')).toStrictEqual({ reason: 'decimals', message: '只有最后一段可以带小数' });
    expect(errorOf('118 60', 'lng')).toStrictEqual({ reason: 'minutes', message: '分要小于 60' });
    expect(errorOf('118 46 60', 'lng')).toStrictEqual({ reason: 'seconds', message: '秒要小于 60' });
    expect(errorOf('1184', 'lng')).toStrictEqual({ reason: 'range', message: '经度要在 -180～180 之间' });
    // 写了单位就按单位，不当作连写
    expect(errorOf('1184640°', 'lng')?.reason).toBe('range');
    expect(errorOf('180.000001', 'lng')?.reason).toBe('range');
    expect(errorOf('118.5', 'lat')).toStrictEqual({ reason: 'range', message: '纬度要在 -90～90 之间' });
    expect(parseCoordinate('180', 'lng').ok).toBe(true);
    expect(parseCoordinate('-90', 'lat').ok).toBe(true);
  });

  it('识别出的值是十进制的度', () => {
    expect(parseCoordinate('118°46′40″', 'lng')).toStrictEqual({ ok: true, value: 118 + 46 / 60 + 40 / 3600 });
  });
});

describe('坐标的格式', () => {
  it('输入框：度分秒补齐两位，秒保留两位小数；小数 6 位', () => {
    expect(formatCoordinate(118.777_778, 'dms')).toBe('118°46′40.00″');
    expect(formatCoordinate(32.0565, 'dms')).toBe('32°03′23.40″');
    expect(formatCoordinate(5.001, 'dms')).toBe('5°00′03.60″');
    expect(formatCoordinate(-118.5, 'dms')).toBe('-118°30′00.00″');
    expect(formatCoordinate(118.777_777_7, 'decimal')).toBe('118.777778');
    expect(formatCoordinate(-118.5, 'decimal')).toBe('-118.500000');
  });

  it('秒进位时不出现 60″；接近 0 的负数不显示负号', () => {
    expect(formatCoordinate(118 + 46 / 60 + 59.999 / 3600, 'dms')).toBe('118°47′00.00″');
    expect(formatCoordinate(118 + 59 / 60 + 59.999 / 3600, 'dms')).toBe('119°00′00.00″');
    expect(formatCoordinate(-0.000_000_1, 'decimal')).toBe('0.000000');
    expect(formatCoordinate(-0.000_000_1, 'dms')).toBe('0°00′00.00″');
  });

  it('复制的一对坐标：小数经度在前、逗号分隔；度分秒带方向', () => {
    expect(formatLngLat([118.7778, 32.0565], 'decimal')).toBe('118.777800, 32.056500');
    expect(formatLngLat([118.777_778, 32.0565], 'dms')).toBe('118°46′40.00″E, 32°03′23.40″N');
    expect(formatLngLat([-73.5, -33.25], 'dms')).toBe('73°30′00.00″W, 33°15′00.00″S');
  });

  it('格式化后的文字能识别回原来的值（精度内）', () => {
    for (const value of [118.777_778, 32.056_5, 0.000_3, -73.123_456]) {
      const dms = parseCoordinate(formatCoordinate(value, 'dms'), 'lng');
      const decimal = parseCoordinate(formatCoordinate(value, 'decimal'), 'lng');
      expect(dms.ok && Math.abs(dms.value - value) < 0.01 / 3600).toBe(true);
      expect(decimal.ok && Math.abs(decimal.value - value) < 1e-6).toBe(true);
    }
  });
});

describe('一次粘贴一对坐标', () => {
  it.each([
    ['118.7778, 32.0565', ['118.7778', '32.0565']],
    ['118.7778，32.0565', ['118.7778', '32.0565']],
    ['118.7778;32.0565', ['118.7778', '32.0565']],
    ['118.7778\n32.0565', ['118.7778', '32.0565']],
    ['118.7778 32.0565', ['118.7778', '32.0565']],
    ['118°46′40″E, 32°03′23″N', [`118°46'40"E`, `32°03'23"N`]],
    ['118°46′40″E 32°03′23″N', [`118°46'40"E`, `32°03'23"N`]],
    ['E118.7778 N32.0565', ['E118.7778', 'N32.0565']],
    ['E118°46′40″ N32°03′23″', [`E118°46'40"`, `N32°03'23"`]],
    ['东经118.7778 北纬32.0565', ['东经118.7778', '北纬32.0565']]
  ])('%s', (text, expected) => {
    expect(splitCoordinatePair(text)).toStrictEqual(expected);
  });

  it('不是一对坐标时为 null：单个坐标、只有整数的"度, 分"、认不出来的', () => {
    expect(splitCoordinatePair('118.7778')).toBeNull();
    expect(splitCoordinatePair('118 46 40')).toBeNull();
    expect(splitCoordinatePair('118, 46')).toBeNull();
    expect(splitCoordinatePair('118,46,40')).toBeNull();
    expect(splitCoordinatePair('118.7778, abc')).toBeNull();
    expect(splitCoordinatePair('118.7778, 32.0565, 10')).toBeNull();
    expect(splitCoordinatePair('32.0565, 118.7778')).toBeNull();
  });
});

describe('经纬度填反', () => {
  it('纬度超出范围而经度不超过 90 时提示', () => {
    expect(looksSwapped('32.0565', '118.7778')).toBe(true);
    expect(looksSwapped('118.7778', '32.0565')).toBe(false);
    expect(looksSwapped('118.7778', '118.7778')).toBe(false);
    expect(looksSwapped('32.0565', 'abc')).toBe(false);
    expect(looksSwapped('abc', '118.7778')).toBe(false);
  });
});
