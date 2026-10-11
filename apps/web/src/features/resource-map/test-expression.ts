import { Color, createExpression, latest, type StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';

// latest 的类型由 JSON 推断（type 是 string），按 MapLibre 内部的用法当作属性规范
const FILL_COLOR = latest.paint_fill['fill-color'] as StylePropertySpecification;

/** 颜色表达式能否被 MapLibre 解析（match 要求取值不重复） */
export function parsesAsColor(expression: unknown): boolean {
  return createExpression(expression, 'fill-color', FILL_COLOR).result === 'success';
}

/** 按 MapLibre 的语义对一个面要素求颜色，结果统一成 Color 的字符串形式 */
export function colorOf(expression: unknown, properties: Record<string, string>): string {
  const parsed = createExpression(expression, 'fill-color', FILL_COLOR);
  if (parsed.result !== 'success') {
    throw new Error(parsed.value.map(({ message }) => message).join('；'));
  }
  return String(parsed.value.evaluate({ zoom: 12 }, { type: 'Polygon', properties }));
}

/** 统一成 Color 的字符串形式，便于和 colorOf 的结果比较 */
export function normalizeColor(value: string): string {
  return String(Color.parse(value));
}
