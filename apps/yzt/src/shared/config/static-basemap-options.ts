// 代码里的产品开关：所有部署都一样，改了要重新构建，不进 .env（分类见 docs/config/overview.md）
// Node 直接运行的 basemap:generate 也导入这个文件，所以不能导入 Vite 专用的模块

/** 静态底图的开关（ADR 0134） */
export interface StaticBasemapOptions {
  /** 各市分色；关闭时全省用 STATIC_LAND_COLOR */
  readonly cityColors: boolean;
}

/** 只在这里改，不进 .env；改了 cityColors 要运行 basemap:generate 更新缩略图 */
export const STATIC_BASEMAP_OPTIONS: StaticBasemapOptions = { cityColors: false };
