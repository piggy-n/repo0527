import { z } from 'zod';
import { http } from '../http/client';
import { SCENE_TIER_SETTINGS, type SceneTierSetting } from './scene-tier-options';

// 发布目录的 scene-tier.json（ADR 0155 第 2 节）：部署方按现场的机器指定档位，替换文件、刷新页面就生效
const sceneTierFileSchema = z.object({ tier: z.enum(SCENE_TIER_SETTINGS) });

/** 部署方指定的三维档位：读不到、格式不对时按 auto；请求被取消时照样抛出 */
export async function fetchSceneTierSetting(signal?: AbortSignal): Promise<SceneTierSetting> {
  // 带时间戳绕过缓存，同 resource-min-zooms.json
  const url = new URL(`${import.meta.env.BASE_URL}scene-tier.json`, window.location.href);
  url.searchParams.set('t', String(Date.now()));
  try {
    const { tier } = await http.get(url.href, { schema: sceneTierFileSchema, envelope: false, signal, silent: true });
    return tier;
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    console.warn('[scene-tier] 读不到部署的三维档位，按 auto', error);
    return 'auto';
  }
}
