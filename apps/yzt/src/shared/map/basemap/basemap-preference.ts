import { z } from 'zod';
import type { BasemapOption, BasemapState } from './basemap-style';

const opacity = z.number().min(0).max(1);

/** 存下的底图偏好（ADR 0042）：选中的底图和每种底图各自的透明度 */
export const storedBasemapSchema = z.object({
  selected: z.enum(['vector', 'imagery', 'static', 'none']),
  opacity: z.object({ vector: opacity, imagery: opacity, static: opacity })
});

/** 存下的标注显隐（ADR 0146）：单独一项，底图偏好关着时也记住 */
export const storedBasemapLabelsSchema = z.boolean();

/** 存下的偏好合并进当前状态：选中的底图当前不可用（换了部署环境，ADR 0031、0032、0133）时保留当前的选择 */
export function restoredBasemapState(
  stored: z.infer<typeof storedBasemapSchema>,
  current: BasemapState,
  options: readonly BasemapOption[]
): BasemapState {
  const available = options.some(option => option.id === stored.selected);
  return { selected: available ? stored.selected : current.selected, opacity: stored.opacity };
}
