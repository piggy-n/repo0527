/** 名称后面用全角括号写单位；单位为空（如无量纲的指数）时只写名称，不留空括号 */
export function withUnit(name: string, unit: string): string {
  return unit ? `${name}（${unit}）` : name;
}
