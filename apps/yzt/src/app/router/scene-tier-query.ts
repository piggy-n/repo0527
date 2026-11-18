import type { Router } from 'vue-router';
import type { SceneTierSetting } from '@/shared/config/scene-tier-options';
import { SCENE_TIER_QUERY, sceneTierQueryValue } from '@/shared/map/scene-tier/browser-setting';
import { RouteName } from '@/shared/router/route-names';

/**
 * 三维档位的地址栏参数（ADR 0166）：进入现状底图（页面缓存时就是重新激活）的导航带上 ?scene-tier=，
 * 值是这个页面启动时读到的本浏览器的设定（app/scene-tier-setting.ts），没有时 default。
 * 改写的是这次导航的目标，push 还是 replace 沿用原来的导航；同一个页面里的历史记录都按同一个值写，后退、前进到它们不再改写
 */
export function installSceneTierQuery(router: Router, setting: SceneTierSetting | undefined): void {
  const value = sceneTierQueryValue(setting);
  router.beforeEach(to => {
    if (to.name !== RouteName.currentMap || to.query[SCENE_TIER_QUERY] === value) {
      return true;
    }
    return { name: RouteName.currentMap, query: { ...to.query, [SCENE_TIER_QUERY]: value }, hash: to.hash };
  });
}
