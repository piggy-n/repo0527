import {
  Color,
  createExpression,
  createPropertyExpression,
  latest,
  type StylePropertySpecification
} from '@maplibre/maplibre-gl-style-spec';
import { classExpression, type ColorRule } from './classification';

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

/** 按 MapLibre 的语义求一个 paint 属性在某一级、某个要素上的值；缩放只能作为顶层插值的输入等规则也一并检查 */
export function paintValueOf(
  layerType: 'fill' | 'line' | 'circle',
  property: string,
  value: unknown,
  properties: Record<string, string>,
  zoom = 12
): unknown {
  const paint: Record<string, unknown> = latest[`paint_${layerType}`];
  // 同 FILL_COLOR，按属性规范使用
  const spec = paint[property] as StylePropertySpecification;
  const parsed = createPropertyExpression(value, property, spec);
  if (parsed.result !== 'success') {
    throw new Error(parsed.value.map(({ message }) => message).join('；'));
  }
  const geometry = { fill: 'Polygon', line: 'LineString', circle: 'Point' } as const;
  return parsed.value.evaluate({ zoom }, { type: geometry[layerType], properties });
}

/** 规则按各取值默认颜色组合的表达式，即没有覆盖时分类样式的主色 */
export function defaultColorExpression(rule: ColorRule) {
  return classExpression(rule, item => item.color);
}

/** 统一成 Color 的字符串形式，便于和 colorOf 的结果比较 */
export function normalizeColor(value: string): string {
  return String(Color.parse(value));
}
