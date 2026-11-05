import type { ExpressionInputType, ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';

/** `match` 各分支的输出：颜色、数值，或者表达式（数组要用 literal 包起来） */
export type MatchOutput = ExpressionInputType | ExpressionSpecification;

/** 按取值对照的 `match` 表达式；没有取值时直接用兜底值（`match` 至少要一组取值） */
export function matchExpression<T extends MatchOutput>(
  input: ExpressionSpecification,
  cases: readonly (readonly [label: string, output: T | ExpressionSpecification])[],
  fallback: T | ExpressionSpecification
): T | ExpressionSpecification {
  const [first, ...rest] = cases;
  if (!first) {
    return fallback;
  }
  return ['match', input, ...first, ...rest.flat(), fallback];
}
