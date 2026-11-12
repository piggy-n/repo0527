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
  /** 用户选的样式方式（ADR 0123 第 3 节）；分类样式只在同时有统一样式的覆盖时才记，其他时候它就是默认 */
  readonly mode?: SymbolMode;
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

/** 偏好的名称和存储格式的版本：页面保存、symbols:import 读导出的数据都按它（ADR 0044、0154） */
export const RESOURCE_SYMBOLS_PREFERENCE = 'resource-symbols';
export const RESOURCE_SYMBOLS_VERSION = 1;

/** 代码给出的样式方式：按属性配色的资源默认是分类样式 */
export const CODE_DEFAULT_MODE: SymbolMode = 'classified';

const isEmpty = (override: SymbolOverride | undefined) => !override || Object.keys(override).length === 0;

/**
 * 一层覆盖决定的样式方式（ADR 0123 第 3 节、ADR 0154）：选过的方式；没选过时调过统一样式的是统一样式，
 * 只调过取值的是分类样式；都没调过时由下面一层决定
 */
export function layerMode(override: ResourceSymbolOverride | undefined, below: SymbolMode): SymbolMode {
  if (override?.mode) {
    return override.mode;
  }
  if (override?.uniform) {
    return 'uniform';
  }
  return override?.items ? 'classified' : below;
}

/**
 * 去掉空的统一样式和取值，什么都不剩时为 undefined；样式方式和下面一层的默认方式相同、
 * 由调过的内容也推得出时不记（ADR 0154）
 */
export function pruneOverride(
  override: ResourceSymbolOverride,
  defaultMode: SymbolMode = CODE_DEFAULT_MODE
): ResourceSymbolOverride | undefined {
  const items = Object.entries(override.items ?? {}).filter(([, item]) => !isEmpty(item));
  const content: ResourceSymbolOverride = {
    ...(isEmpty(override.uniform) ? {} : { uniform: override.uniform }),
    ...(items.length > 0 ? { items: Object.fromEntries(items) } : {})
  };
  const { mode } = override;
  const keepsMode = mode !== undefined && (mode !== defaultMode || mode !== layerMode(content, defaultMode));
  const pruned: ResourceSymbolOverride = {
    ...(content.uniform ? { uniform: content.uniform } : {}),
    ...(keepsMode ? { mode } : {}),
    ...(content.items ? { items: content.items } : {})
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

/** 换掉目标的覆盖，去掉空的部分；defaultMode 是资源的默认样式方式 */
export function withTargetOverride(
  override: ResourceSymbolOverride | undefined,
  item: string | undefined,
  next: SymbolOverride,
  defaultMode: SymbolMode = CODE_DEFAULT_MODE
): ResourceSymbolOverride | undefined {
  if (item === undefined) {
    return pruneOverride({ ...override, uniform: next }, defaultMode);
  }
  return pruneOverride({ ...override, items: { ...override?.items, [item]: next } }, defaultMode);
}

/** 推导用的覆盖：确认的覆盖再叠加临时预览 */
export function effectiveOverride(
  overrides: SymbolOverrides,
  preview: SymbolPreview | null,
  code: string,
  defaultMode: SymbolMode = CODE_DEFAULT_MODE
): ResourceSymbolOverride | undefined {
  const override = overrides.get(code);
  if (preview?.code !== code) {
    return override;
  }
  const color: Partial<Record<ColorField, string>> = { [preview.field]: preview.color };
  const next = { ...targetOverride(override, preview.item), ...color };
  return withTargetOverride(override, preview.item, next, defaultMode);
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
    mode: z.enum(['uniform', 'classified']).optional(),
    items: z.record(z.string(), overrideSchema).optional()
  })
);

export type StoredSymbols = z.infer<typeof storedSymbolsSchema>;

/** 当前的覆盖转成存储格式 */
export function toStoredSymbols(overrides: SymbolOverrides): StoredSymbols {
  return Object.fromEntries(overrides);
}

/** 存下的覆盖还原；空的部分去掉，什么都不剩的资源不留；defaultModeOf 给出各资源的默认样式方式 */
export function fromStoredSymbols(
  stored: StoredSymbols,
  defaultModeOf: (code: string) => SymbolMode = () => CODE_DEFAULT_MODE
): SymbolOverrides {
  return new Map(
    Object.entries(stored).flatMap(([code, override]) => {
      const pruned = pruneOverride(override, defaultModeOf(code));
      return pruned ? [[code, pruned] as const] : [];
    })
  );
}
