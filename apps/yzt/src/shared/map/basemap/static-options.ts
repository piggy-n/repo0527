/** 静态底图的开关（ADR 0134） */
export interface StaticBasemapOptions {
  /** 各市分色；关闭时全省用 STATIC_LAND_COLOR */
  readonly cityColors: boolean;
}

/** 只在这里改，不进 .env；改了 cityColors 要运行 basemap:generate 更新缩略图 */
export const STATIC_BASEMAP_OPTIONS: StaticBasemapOptions = { cityColors: false };
