import { z } from 'zod';
import type { ResourceDisplay, ResourceLayersState } from './resource-layers';

const displaySchema = z.object({
  checked: z.boolean(),
  opacity: z.number().min(0).max(1),
  year: z.number().int()
});

/**
 * 存下的资源图层偏好（ADR 0042）：每个资源的勾选、透明度、年份和面板顺序，以及最后一次批量设置的年份（ADR 0116）。
 * 除了类型和范围，还要自洽：顺序不能有重复，并且和各资源的设置一一对应，否则会推导出重复的图层 ID
 */
export const storedResourceLayersSchema = z
  .object({
    displays: z.record(z.string(), displaySchema),
    order: z.array(z.string()),
    // 2026-10-29 之前存下的没有这一项，按没有批量设置过；格式只是多了一项，版本不变
    batchYear: z.number().int().nullable().optional()
  })
  .refine(
    ({ displays, order }) =>
      new Set(order).size === order.length &&
      order.length === Object.keys(displays).length &&
      order.every(code => Object.hasOwn(displays, code)),
    { message: '面板顺序有重复，或者和各资源的设置对不上' }
  );

export type StoredResourceLayers = z.infer<typeof storedResourceLayersSchema>;

/** 当前状态的存储格式：普通的对象和数组，不存目录 */
export function toStoredResourceLayers(
  { displays, order }: ResourceLayersState,
  batchYear: number | null
): StoredResourceLayers {
  return { displays: Object.fromEntries(displays), order: [...order], batchYear };
}

/** 存下的偏好还原成不带目录的显示状态；目录到了以后按 ADR 0041 第 3 节合并，不直接使用 */
export function fromStoredResourceLayers({ displays, order }: StoredResourceLayers): ResourceLayersState {
  return { catalog: null, displays: new Map<string, ResourceDisplay>(Object.entries(displays)), order };
}
