// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SCENE_TIER_SETTINGS as APP_SETTINGS } from '../../src/shared/config/scene-tier-options.ts';
import { SCENE_TIER_SETTINGS } from './scene-tiers.ts';

// 冒烟（Playwright）不导入应用源码，档位写了一份；这个单元测试由 Vitest 跑，保证两份相等
describe('冒烟用的三维档位清单', () => {
  it('和应用的 SCENE_TIER_SETTINGS 相等：不相等时冒烟会把合法的档位判成不合法，或者放过应用不认的值', () => {
    expect(SCENE_TIER_SETTINGS).toStrictEqual([...APP_SETTINGS]);
  });
});
