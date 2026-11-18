import { z } from 'zod';
import { SCENE_TIER_SETTINGS, type SceneTierSetting } from '../../config/scene-tier-options';
import type { DeviceStore } from '../../storage/device-store';

// 本浏览器的三维档位设定（ADR 0166，docs/config/scene-tier.md"本浏览器的设定"）：启动时读地址栏的 ?scene-tier=，
// 记在设备级存储里，这个浏览器按它、不按部署文件；可以比部署文件高，也可以低

/** 地址栏的参数名 */
export const SCENE_TIER_QUERY = 'scene-tier';

/** 参数写它时清掉本浏览器的设定，回到部署文件；现状底图的地址在没有设定时也显示它 */
export const SCENE_TIER_QUERY_DEFAULT = 'default';

const SETTING_KEY = 'scene-tier:setting';
const settingSchema = z.enum(SCENE_TIER_SETTINGS);

/** 存着的本浏览器的设定；没有时 undefined，按部署文件 */
export function readBrowserSetting(store: DeviceStore): SceneTierSetting | undefined {
  return store.get(SETTING_KEY, settingSchema);
}

/**
 * 启动时（路由第一次导航、登录跳转之前）读一次地址栏的参数：认得的值记下，default 清掉，不认得的只警告。
 * 返回这个页面用的设定，之后不再读存储：别的标签页再改，这个页面的地址栏和三维都不变
 */
export function applySceneTierQuery(search: string, store: DeviceStore): SceneTierSetting | undefined {
  const value = new URLSearchParams(search).get(SCENE_TIER_QUERY);
  if (value === SCENE_TIER_QUERY_DEFAULT) {
    const cleared = readBrowserSetting(store);
    store.remove(SETTING_KEY);
    if (cleared !== undefined) {
      // 别人分享的、旧书签里的 default 也会清掉设定，留一行让现场知道档位为什么变了（ADR 0166）
      // oxlint-disable-next-line no-console -- 清掉设定是状态变化，现场按控制台核对
      console.info(`[scene-tier] 地址栏的 ${SCENE_TIER_QUERY}=default 清掉了本浏览器的设定（原来是 ${cleared}），回到部署文件`);
    }
    return undefined;
  }
  if (value !== null) {
    const parsed = settingSchema.safeParse(value);
    if (parsed.success) {
      store.set(SETTING_KEY, parsed.data);
      return parsed.data;
    }
    const values = [SCENE_TIER_QUERY_DEFAULT, ...SCENE_TIER_SETTINGS].join('、');
    console.warn(`[scene-tier] 地址栏的 ${SCENE_TIER_QUERY}=${value} 不认得，本浏览器的设定不变；能写 ${values}`);
  }
  return readBrowserSetting(store);
}

/** 地址栏里该显示的值：本浏览器的设定，没有时 default（不写实际的档位，分享出去的链接不会把档位定死在别的机器上） */
export function sceneTierQueryValue(setting: SceneTierSetting | undefined): string {
  return setting ?? SCENE_TIER_QUERY_DEFAULT;
}
