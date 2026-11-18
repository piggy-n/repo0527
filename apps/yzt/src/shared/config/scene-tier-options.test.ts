// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SCENE_TIER_BUDGETS, SCENE_TIER_SETTINGS, SCENE_TIERS } from './scene-tier-options';

const MEGABYTE = 1024 * 1024;
const GIGABYTE = 1024 * MEGABYTE;

// 上传和泼溅各档相同，只有缓存的两个数不同
const budget = (cacheGB: number, limitGB: number) => ({
  cacheBytes: cacheGB * GIGABYTE,
  cacheLimitBytes: limitGB * GIGABYTE,
  uploadBytesPerFrame: 16 * MEGABYTE,
  splatBudget: 3_000_000
});

describe('三维的设备档位', () => {
  it('从低到高四档，工作站档最高；scene-tier.json 另外能写 auto', () => {
    expect(SCENE_TIERS).toStrictEqual(['low', 'standard', 'high', 'workstation']);
    expect(SCENE_TIER_SETTINGS).toStrictEqual(['auto', 'low', 'standard', 'high', 'workstation']);
  });

  it('各档的数值：工作站档 12 GB 不再加载、淘汰到 9 GB（ADR 0166），原来三档不变（ADR 0155）', () => {
    expect(SCENE_TIER_BUDGETS).toStrictEqual({
      low: budget(0.5, 1),
      standard: budget(1, 2),
      high: budget(3, 6),
      workstation: budget(9, 12)
    });
  });

  it('越高的档两个缓存的数都越大：一次降一档就是缩小预算', () => {
    const limits = SCENE_TIERS.map(tier => SCENE_TIER_BUDGETS[tier].cacheLimitBytes);
    const evictions = SCENE_TIERS.map(tier => SCENE_TIER_BUDGETS[tier].cacheBytes);
    // 严格递增：排好了序，也没有相等的
    for (const values of [limits, evictions]) {
      expect(values).toStrictEqual(values.toSorted((a, b) => a - b));
      expect(new Set(values).size).toBe(values.length);
    }
    for (const { cacheBytes, cacheLimitBytes } of Object.values(SCENE_TIER_BUDGETS)) {
      expect(cacheBytes).toBeLessThan(cacheLimitBytes);
    }
  });
});
