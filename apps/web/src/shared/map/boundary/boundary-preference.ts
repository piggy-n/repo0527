import { z } from 'zod';

/** 存下的边界偏好（ADR 0042）：三个级别是否显示和共用的透明度；校验通过就整体采用 */
export const storedBoundariesSchema = z.object({
  visible: z.object({ province: z.boolean(), city: z.boolean(), county: z.boolean() }),
  opacity: z.number().min(0).max(1)
});
