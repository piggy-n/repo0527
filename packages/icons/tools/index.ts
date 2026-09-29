// Node 端入口：规范化工具与 Vite 插件，不会被打进浏览器产物
export { isMulticolor, MULTICOLOR_SUFFIX, toIconName } from './naming.ts';
export { normalizeIcon, type NormalizedIcon } from './normalize.ts';
export { describeReport, type IconsOptions, isUpToDate, syncIcons, type SyncReport } from './sync.ts';
export { iconsPlugin } from './vite-plugin.ts';
