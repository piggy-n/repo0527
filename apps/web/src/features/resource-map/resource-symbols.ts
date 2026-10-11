import { z } from 'zod';
import {
  type ColorField,
  LINE_DASH_NAMES,
  normalizeColor,
  POINT_STROKE_WIDTHS,
  SIZE_LEVELS,
  SIZE_REFERENCES,
  type SymbolOverride
} from './symbols';

// 符号覆盖的数据（ADR 0044 第 3、5 节）：按资源记，只记和默认不同的字段；拥有者 useResourceSymbols 持有

/** 一个资源的覆盖：5C.5a 只有统一样式，样式方式和逐项覆盖在 5C.5b 加入 */
export interface ResourceSymbolOverride {
  readonly uniform?: SymbolOverride;
}

export type SymbolOverrides = ReadonlyMap<string, ResourceSymbolOverride>;

/** 拖动取色时的临时预览：某个资源统一样式的一个颜色字段；参与推导，不写入覆盖、不保存（ADR 0044 第 6 节） */
export interface SymbolPreview {
  readonly code: string;
  readonly field: ColorField;
  readonly color: string;
}

/** 推导时按资源取覆盖；返回 undefined 表示用默认符号 */
export type SymbolOverrideOf = (code: string) => SymbolOverride | undefined;

export const noSymbolOverride: SymbolOverrideOf = () => undefined;

/** 推导用的覆盖：确认的覆盖再叠加临时预览 */
export function effectiveOverride(
  overrides: SymbolOverrides,
  preview: SymbolPreview | null,
  code: string
): SymbolOverride | undefined {
  const uniform = overrides.get(code)?.uniform;
  if (preview?.code !== code) {
    return uniform;
  }
  return { ...uniform, [preview.field]: preview.color };
}

const colorSchema = z.string().refine(value => normalizeColor(value) !== null, '颜色解析不了');

const sizeSchema = (geometry: 'circle' | 'line') => {
  const { min, max } = SIZE_REFERENCES[geometry];
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
  outlineColor: colorSchema.optional()
});

/** 存下的符号覆盖：按资源的普通对象 */
export const storedSymbolsSchema = z.record(z.string(), z.object({ uniform: overrideSchema.optional() }));

export type StoredSymbols = z.infer<typeof storedSymbolsSchema>;

/** 当前的覆盖转成存储格式 */
export function toStoredSymbols(overrides: SymbolOverrides): StoredSymbols {
  return Object.fromEntries(overrides);
}

/** 存下的覆盖还原；没有任何字段的资源不留 */
export function fromStoredSymbols(stored: StoredSymbols): SymbolOverrides {
  return new Map(
    Object.entries(stored).filter(([, override]) => override.uniform && Object.keys(override.uniform).length > 0)
  );
}
