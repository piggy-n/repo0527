// 三维的设备档位（ADR 0155、0166，docs/config/scene-tier.md）：各档的数值所有部署都一样，部署方在发布目录的 scene-tier.json、
// 用户在地址栏的 ?scene-tier= 选档
// 只写类型和常量，不导入别的模块：measure:3d 也导入它

/** 档位，从低到高：崩溃、丢上下文时按这个顺序一次降一档 */
export const SCENE_TIERS = ['low', 'standard', 'high', 'workstation'] as const;

export type SceneTier = (typeof SCENE_TIERS)[number];

/** 档位的中文名：控制台里定档的那一行、测量报告用 */
export const SCENE_TIER_NAMES: Readonly<Record<SceneTier, string>> = {
  low: '低档',
  standard: '标准档',
  high: '高档',
  workstation: '工作站档'
};

/** scene-tier.json 和本浏览器的设定能写的值：auto 按显卡型号查显存判断 */
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
// 上传和泼溅各档相同：每帧上传管的是帧时间，和显存大小无关；泼溅在集显上要不要降、在工作站上要不要升都没有实测
const UPLOAD_BYTES_PER_FRAME = 16 * MEGABYTE;
const SPLAT_BUDGET = 3_000_000;

/** 各档的数值：2026-11-12 定，高档同日按 1920×1080 的补测从 4 GB 改为 6 GB；工作站档 2026-11-17 定（ADR 0166） */
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
  },
  // 16 GB 显存、1920×1080：按高档在 6 GB 显存上的实测外推；淘汰线 9 GB 让新吴区交界处 z17 转回来不重新下载，z18 只留得下一部分（ADR 0166 后果）
  workstation: {
    cacheBytes: 9 * GIGABYTE,
    cacheLimitBytes: 12 * GIGABYTE,
    uploadBytesPerFrame: UPLOAD_BYTES_PER_FRAME,
    splatBudget: SPLAT_BUDGET
  }
};
