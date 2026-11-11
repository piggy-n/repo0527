// 静态底图的配色（ADR 0133、0134），地图样式和缩略图共用；地图样式里的颜色是数据，不走 CSS 令牌

/** 省外的底色 */
export const STATIC_OUTSIDE_COLOR = '#E6EAF0';

/** 市与市之间的细线 */
export const STATIC_CITY_LINE_COLOR = '#FFFFFF';

/** 全省的陆地色 CREAM：原色 #F7F3E6 按 75% 叠在省外底色上换算出的不透明色值，换算方式见 ADR 0134 */
export const STATIC_LAND_COLOR = '#F3F1E9';
