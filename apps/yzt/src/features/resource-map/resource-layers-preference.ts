import { z } from 'zod';
import { NO_FILTER } from './feature-filter';
import type { ResourceDisplay, ResourceLayersState } from './resource-layers';

const displaySchema = z.object({
  // 2026-11-14 之前存下的没有这一项，那时勾选就是在地图上，按 checked 算（ADR 0157）；格式只是多了一项，版本不变
  added: z.boolean().optional(),
  checked: z.boolean(),
  opacity: z.number().min(0).max(1),
  year: z.number().int(),
  // 2026-11-16 之前存下的没有这一项，那时没有标注，按不显示算（ADR 0160）；格式只是多了一项，版本不变
  labeled: z.boolean().optional(),
  // 要素过滤（ADR 0173）：字段 → 勾着的取值；2026-11-24 之前存下的没有这一项，按不过滤算；格式只是多了一项，版本不变。
  // 字段和取值不在这里校验，目录到了以后按能过滤的字段整理（mergeDisplayState）
  filter: z.record(z.string(), z.array(z.string()).readonly()).optional()
});

// 一套已添加的资源：各资源的设置、叠放顺序和最后一次批量设置的年份
const setShape = {
  displays: z.record(z.string(), displaySchema),
  order: z.array(z.string()),
  // 2026-10-29 之前存下的没有这一项，按没有批量设置过；格式只是多了一项，版本不变
  batchYear: z.number().int().nullable().optional()
};

// 顺序不能有重复，并且和各资源的设置一一对应，否则会推导出重复的图层 ID
const consistent = ({ displays, order }: { readonly displays: object; readonly order: readonly string[] }) =>
  new Set(order).size === order.length &&
  order.length === Object.keys(displays).length &&
  order.every(code => Object.hasOwn(displays, code));

const CONSISTENT_MESSAGE = { message: '面板顺序有重复，或者和各资源的设置对不上' };

/** 存下的一套资源图层（ADR 0042、0169）：每个资源的加入、勾选、透明度、年份、标注的显隐、要素过滤和叠放顺序，以及批量设置的年份 */
export const storedResourceLayerSetSchema = z.object(setShape).refine(consistent, CONSISTENT_MESSAGE);

export type StoredResourceLayerSet = z.infer<typeof storedResourceLayerSetSchema>;

/**
 * 存下的资源图层偏好（ADR 0042）：顶层是一套（最后一次批量设置的年份见 ADR 0116），scene 是按维度分开时三维的那一套
 * （ADR 0169）。顶层在不分开时二三维共用、分开时是二维的；2026-11-22 之前存下的没有 scene，格式只是多了一项，版本不变
 */
export const storedResourceLayersSchema = z
  .object({ ...setShape, scene: storedResourceLayerSetSchema.optional() })
  .refine(consistent, CONSISTENT_MESSAGE);

export type StoredResourceLayers = z.infer<typeof storedResourceLayersSchema>;

/** 当前状态的存储格式：普通的对象和数组，不存目录 */
export function toStoredResourceLayers(
  { displays, order }: ResourceLayersState,
  batchYear: number | null
): StoredResourceLayerSet {
  return { displays: Object.fromEntries(displays), order: [...order], batchYear };
}

/**
 * 存下的一套还原成不带目录的显示状态；目录到了以后按 ADR 0041 第 3 节合并，不直接使用。
 * 没有 added 的是改版前存的：勾选过的资源算已加入，叠放顺序不变（ADR 0157）；没有 labeled 的不显示标注（ADR 0160）；
 * 没有 filter 的不过滤（ADR 0173）
 */
export function fromStoredResourceLayers({ displays, order }: StoredResourceLayerSet): ResourceLayersState {
  const restored = Object.entries(displays).map(
    ([code, { added, labeled, filter, ...display }]): [string, ResourceDisplay] => [
      code,
      { ...display, added: added ?? display.checked, labeled: labeled ?? false, filter: filter ?? NO_FILTER }
    ]
  );
  return { catalog: null, displays: new Map(restored), order };
}
