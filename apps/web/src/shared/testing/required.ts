// 只供测试使用

/** 用例依赖的值必须存在：不存在时以说明失败，而不是在之后的属性访问上报错 */
export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`没有${what}`);
  }
  return value;
}
