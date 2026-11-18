import { SCENE_TIERS, type SceneTier } from '../../config/scene-tier-options';
import { gpuMemory, rendererModel } from './gpu-memory';
import { isIntegratedRenderer, SOFTWARE_RENDERER } from './renderer-class';

// auto 的档位（ADR 0166 修改 ADR 0155 第 3 节，docs/config/scene-tier.md"auto"）：软件渲染、集显给低，
// 独显按型号查显存定档，查不到的给标准；拿不准时往低定：定高了只会慢，降档的保险都不动作

/** auto 的结果：档位和依据，控制台里定档的那一行按它写 */
export type AutoTier =
  | {
      readonly tier: SceneTier;
      /** 显存表里有，或者名字里写了显存 */
      readonly basis: 'listed';
      readonly device: string;
      /** 显存（GB） */
      readonly vram: number;
      /** 内存压低了档位时是 navigator.deviceMemory（GB），没压时是 null */
      readonly memoryCap: number | null;
    }
  | {
      readonly tier: SceneTier;
      /** 软件渲染、集显、读不到型号（浏览器不给或换成了代表型号）、显存表里没有 */
      readonly basis: 'software' | 'integrated' | 'hidden' | 'unlisted';
      /** 驱动里的设备名；取不出时是渲染器的原文 */
      readonly device: string;
    };

// 显存到多少给哪一档，从高往低找；都不到的给标准
const VRAM_TIERS: readonly (readonly [gigabytes: number, tier: SceneTier])[] = [
  [16, 'workstation'],
  [8, 'high']
];

const rank = (tier: SceneTier): number => SCENE_TIERS.indexOf(tier);

// 内存允许的最高档：navigator.deviceMemory 只有 Chromium 内核在安全上下文里给（内网的 http 下没有，不压），按 2 的幂取整。
// Chrome 147 以前最多报 8，8 分不出是封顶还是真的只有 8 GB，不压；16 只有 147 起才报（内存 12～24 GB），不够工作站档的 32 GB
function memoryLimit(memory: number | undefined): SceneTier | null {
  if (memory === undefined) {
    return null;
  }
  if (memory < 8) {
    return 'standard';
  }
  if (memory > 8 && memory < 32) {
    return 'high';
  }
  return null;
}

/** auto 的档位：renderer 是 WebGL 报的显卡名字，deviceMemory 是 navigator.deviceMemory（没有时不压） */
export function autoTier(renderer: string, deviceMemory?: number): AutoTier {
  const model = rendererModel(renderer);
  const device = model ?? renderer;
  if (SOFTWARE_RENDERER.test(renderer)) {
    return { tier: 'low', basis: 'software', device };
  }
  if (isIntegratedRenderer(renderer)) {
    return { tier: 'low', basis: 'integrated', device };
  }
  if (model === null) {
    return { tier: 'standard', basis: 'hidden', device };
  }
  const vram = gpuMemory(model);
  if (vram === undefined) {
    return { tier: 'standard', basis: 'unlisted', device };
  }
  const byVram = VRAM_TIERS.find(([gigabytes]) => vram >= gigabytes)?.[1] ?? 'standard';
  const limit = memoryLimit(deviceMemory);
  if (limit !== null && deviceMemory !== undefined && rank(limit) < rank(byVram)) {
    return { tier: limit, basis: 'listed', device, vram, memoryCap: deviceMemory };
  }
  return { tier: byVram, basis: 'listed', device, vram, memoryCap: null };
}
