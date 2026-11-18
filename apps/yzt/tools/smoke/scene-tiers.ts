// 发布的 scene-tier.json 能写的档位，同 src/shared/config/scene-tier-options.ts 的 SCENE_TIER_SETTINGS：
// 冒烟不导入应用源码（ADR 0065），这里写一份，由 scene-tiers.test.ts 保证相等
export const SCENE_TIER_SETTINGS: readonly string[] = ['auto', 'low', 'standard', 'high', 'workstation'];
