/** 窄屏断点：视口宽度小于它时，顶部导航收进菜单、分栏布局的侧栏收进抽屉；Sass 中的同名变量在 _index.scss */
export const COMPACT_BREAKPOINT = 1200;

/** 窄屏的媒体查询，写法与 Sass 中的 (width < ui.$compact) 相同，两边在同一宽度切换 */
export const COMPACT_MEDIA_QUERY = `(width < ${COMPACT_BREAKPOINT}px)`;
