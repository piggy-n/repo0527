// 静态底图的配色（ADR 0133），地图样式和缩略图共用；地图样式里的颜色是数据，不走 CSS 令牌
const CREAM = '#F7F3E6';
const MOSS = '#F0F3E4';
const SAND = '#F6EEE3';
const MINT = '#ECF2E9';

/** 省外的底色 */
export const STATIC_OUTSIDE_COLOR = '#E6EAF0';

/** 市与市之间的细线 */
export const STATIC_CITY_LINE_COLOR = '#FFFFFF';

/** 各市的颜色，键是市界数据的 code；相邻的市不同色（由测试保证） */
export const STATIC_CITY_COLORS: Readonly<Record<string, string>> = {
  '320100000000': MOSS, // 南京
  '320200000000': MOSS, // 无锡
  '320300000000': CREAM, // 徐州
  '320400000000': SAND, // 常州
  '320500000000': MINT, // 苏州
  '320600000000': SAND, // 南通
  '320700000000': SAND, // 连云港
  '320800000000': CREAM, // 淮安
  '320900000000': MOSS, // 盐城
  '321000000000': SAND, // 扬州
  '321100000000': MINT, // 镇江
  '321200000000': CREAM, // 泰州
  '321300000000': MOSS // 宿迁
};
