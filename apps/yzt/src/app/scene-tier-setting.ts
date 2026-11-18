import { applySceneTierQuery } from '@/shared/map/scene-tier/browser-setting';
import { deviceStore } from '@/shared/storage/device-store';

/**
 * 这个页面用的本浏览器三维档位设定（ADR 0166）：第一次导入时（路由的模块里，首次导航之前）读一次地址栏。
 * 现状底图的地址和三维的档位都用它：别的标签页后来改了设定，这个页面两边都不变，地址栏显示的就是实际用的
 */
export const pageSceneTierSetting = applySceneTierQuery(window.location.search, deviceStore);
