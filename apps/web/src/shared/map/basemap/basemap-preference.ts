import { z } from 'zod';
import type { BasemapOption, BasemapState } from './basemap-style';

const opacity = z.number().min(0).max(1);

/** 存下的底图偏好（ADR 0042）：选中的底图和两种底图各自的透明度 */
export const storedBasemapSchema = z.object({
  selected: z.enum(['vector', 'imagery', 'none']),
  opacity: z.object({ vector: opacity, imagery: opacity })
});

/** 存下的偏好合并进当前状态：选中的底图当前不可用（没有配置天地图，ADR 0031、0032）时保留当前的选择 */
export function restoredBasemapState(
  stored: z.infer<typeof storedBasemapSchema>,
  current: BasemapState,
  options: readonly BasemapOption[]
): BasemapState {
  const available = options.some(option => option.id === stored.selected);
  return { selected: available ? stored.selected : current.selected, opacity: stored.opacity };
}
