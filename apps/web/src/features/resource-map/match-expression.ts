import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';

/** 按取值对照的 `match` 表达式；没有取值时直接用兜底值（`match` 至少要一组取值） */
export function matchExpression(
  input: ExpressionSpecification,
  cases: readonly (readonly [label: string, output: string])[],
  fallback: string | ExpressionSpecification
): string | ExpressionSpecification {
  const [first, ...rest] = cases;
  if (!first) {
    return fallback;
  }
  return ['match', input, ...first, ...rest.flat(), fallback];
}
