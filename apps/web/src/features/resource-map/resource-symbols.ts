import { z } from 'zod';
import {
  type ColorField,
  FILL_STYLE_NAMES,
  LINE_DASH_NAMES,
  normalizeColor,
  POINT_STROKE_WIDTHS,
  SIZE_LEVELS,
  SIZE_REFERENCES,
  type SizeKind,
  type SymbolOverride
} from './symbols';

// 符号覆盖的数据（ADR 0044 第 3、5 节）：按资源记，只记和默认不同的字段；拥有者 useResourceSymbols 持有

/** 样式方式：按属性配色的资源默认是分类样式，可以换成统一样式 */
export type SymbolMode = 'uniform' | 'classified';

/** 要编辑的符号：资源的统一样式，或者分类样式里的一个取值（取值的键见 classification.ts） */
export interface SymbolTarget {
  readonly code: string;
  readonly item?: string;
}

/** 一个资源的覆盖 */
export interface ResourceSymbolOverride {
  readonly uniform?: SymbolOverride;
  /** 按属性配色的资源选了统一样式；分类样式是默认，不记 */
  readonly mode?: 'uniform';
  /** 分类样式各取值的覆盖，按取值的键 */
  readonly items?: Readonly<Record<string, SymbolOverride>>;
}

export type SymbolOverrides = ReadonlyMap<string, ResourceSymbolOverride>;

/** 推导时按资源取覆盖（含临时预览）；返回 undefined 表示都用默认符号 */
export type SymbolOverrideOf = (code: string) => ResourceSymbolOverride | undefined;

export const noSymbolOverride: SymbolOverrideOf = () => undefined;

/** 拖动取色时的临时预览：某个目标的一个颜色字段；参与推导，不写入覆盖、不保存（ADR 0044 第 6 节） */
export interface SymbolPreview {
  readonly code: string;
  readonly item?: string;
  readonly field: ColorField;
  readonly color: string;
}

const isEmpty = (override: SymbolOverride | undefined) => !override || Object.keys(override).length === 0;

/** 去掉空的统一样式和取值；什么都不剩时为 undefined */
export function pruneOverride(override: ResourceSymbolOverride): ResourceSymbolOverride | undefined {
  const items = Object.entries(override.items ?? {}).filter(([, item]) => !isEmpty(item));
  const pruned: ResourceSymbolOverride = {
    ...(isEmpty(override.uniform) ? {} : { uniform: override.uniform }),
    ...(override.mode === 'uniform' ? { mode: 'uniform' } : {}),
    ...(items.length > 0 ? { items: Object.fromEntries(items) } : {})
  };
  return Object.keys(pruned).length > 0 ? pruned : undefined;
}

/** 目标（统一样式或某个取值）的覆盖 */
export function targetOverride(
  override: ResourceSymbolOverride | undefined,
  item: string | undefined
): SymbolOverride | undefined {
  return item === undefined ? override?.uniform : override?.items?.[item];
}

/** 换掉目标的覆盖，去掉空的部分 */
export function withTargetOverride(
  override: ResourceSymbolOverride | undefined,
  item: string | undefined,
  next: SymbolOverride
): ResourceSymbolOverride | undefined {
  if (item === undefined) {
    return pruneOverride({ ...override, uniform: next });
  }
  return pruneOverride({ ...override, items: { ...override?.items, [item]: next } });
}

/** 推导用的覆盖：确认的覆盖再叠加临时预览 */
export function effectiveOverride(
  overrides: SymbolOverrides,
  preview: SymbolPreview | null,
  code: string
): ResourceSymbolOverride | undefined {
  const override = overrides.get(code);
  if (preview?.code !== code) {
    return override;
  }
  const color: Partial<Record<ColorField, string>> = { [preview.field]: preview.color };
  return withTargetOverride(override, preview.item, { ...targetOverride(override, preview.item), ...color });
}

const colorSchema = z.string().refine(value => normalizeColor(value) !== null, '颜色解析不了');

const sizeSchema = (kind: SizeKind) => {
  const { min, max } = SIZE_REFERENCES[kind];
  return z.union([z.enum(SIZE_LEVELS), z.number().min(min).max(max)]);
};

const strokeWidths: readonly number[] = POINT_STROKE_WIDTHS;

// 存储时不知道资源的几何，各字段按自己的范围校验；不属于资源几何的字段在推导时不使用
const overrideSchema = z.object({
  size: sizeSchema('circle').optional(),
  fillColor: colorSchema.optional(),
  strokeColor: colorSchema.optional(),
  strokeWidth: z
    .number()
    .refine(value => strokeWidths.includes(value), '描边宽度只能是 0～3')
    .optional(),
  color: colorSchema.optional(),
  width: sizeSchema('line').optional(),
  dash: z.enum(LINE_DASH_NAMES).optional(),
  outlineColor: colorSchema.optional(),
  fillStyle: z.enum(FILL_STYLE_NAMES).optional(),
  patternColor: colorSchema.optional(),
  outlineWidth: sizeSchema('outline').optional(),
  outlineDash: z.enum(LINE_DASH_NAMES).optional()
});

/** 存下的符号覆盖：按资源的普通对象 */
export const storedSymbolsSchema = z.record(
  z.string(),
  z.object({
    uniform: overrideSchema.optional(),
    mode: z.literal('uniform').optional(),
    items: z.record(z.string(), overrideSchema).optional()
  })
);

export type StoredSymbols = z.infer<typeof storedSymbolsSchema>;

/** 当前的覆盖转成存储格式 */
export function toStoredSymbols(overrides: SymbolOverrides): StoredSymbols {
  return Object.fromEntries(overrides);
}

/** 存下的覆盖还原；空的部分去掉，什么都不剩的资源不留 */
export function fromStoredSymbols(stored: StoredSymbols): SymbolOverrides {
  return new Map(
    Object.entries(stored).flatMap(([code, override]) => {
      const pruned = pruneOverride(override);
      return pruned ? [[code, pruned] as const] : [];
    })
  );
}
