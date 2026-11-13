// 三维的设备档位（ADR 0155，docs/config/scene-tier.md）：各档的数值所有部署都一样，部署方只在发布目录的 scene-tier.json 里选档。
// 只写类型和常量，不导入别的模块：measure:3d 也导入它

/** 档位，从低到高 */
export const SCENE_TIERS = ['low', 'standard', 'high'] as const;

export type SceneTier = (typeof SCENE_TIERS)[number];

/** scene-tier.json 里能写的值：auto 按显卡型号判断 */
export const SCENE_TIER_SETTINGS = ['auto', ...SCENE_TIERS] as const;

export type SceneTierSetting = (typeof SCENE_TIER_SETTINGS)[number];

/** 一档的预算，和 map-core 的 SceneBudget 同形 */
export interface SceneTierBudget {
  /** 瓦片缓存淘汰到的大小（字节） */
  readonly cacheBytes: number;
  /** 到它不再加载（字节） */
  readonly cacheLimitBytes: number;
  /** 每帧提前上传的字节 */
  readonly uploadBytesPerFrame: number;
  /** 高斯泼溅的总预算（高斯个数） */
  readonly splatBudget: number;
}

const MEGABYTE = 1024 * 1024;
const GIGABYTE = 1024 * MEGABYTE;
// 上传和泼溅三档相同：每帧上传管的是帧时间，和显存大小无关；泼溅在集显上要不要降没有实测
const UPLOAD_BYTES_PER_FRAME = 16 * MEGABYTE;
const SPLAT_BUDGET = 3_000_000;

/** 各档的数值：2026-11-12 定，高档同日按 1920×1080 的补测从 4 GB 改为 6 GB */
export const SCENE_TIER_BUDGETS: Readonly<Record<SceneTier, SceneTierBudget>> = {
  low: {
    cacheBytes: 0.5 * GIGABYTE,
    cacheLimitBytes: GIGABYTE,
    uploadBytesPerFrame: UPLOAD_BYTES_PER_FRAME,
    splatBudget: SPLAT_BUDGET
  },
  standard: {
    cacheBytes: GIGABYTE,
    cacheLimitBytes: 2 * GIGABYTE,
    uploadBytesPerFrame: UPLOAD_BYTES_PER_FRAME,
    splatBudget: SPLAT_BUDGET
  },
  high: {
    cacheBytes: 3 * GIGABYTE,
    cacheLimitBytes: 6 * GIGABYTE,
    uploadBytesPerFrame: UPLOAD_BYTES_PER_FRAME,
    splatBudget: SPLAT_BUDGET
  }
};
