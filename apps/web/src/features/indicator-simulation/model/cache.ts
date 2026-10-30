/** 按键缓存纯函数的结果：模型里的值只由参数决定，同样的参数只算一次；缓存随所属的计算器释放 */
export function cached<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  keyOf: (...args: Args) => string
): (...args: Args) => Result {
  // 包一层对象，结果本身是 undefined 时也能分清"算过"和"没算过"
  const results = new Map<string, { readonly value: Result }>();
  return (...args) => {
    const key = keyOf(...args);
    const hit = results.get(key);
    if (hit) {
      return hit.value;
    }
    const value = fn(...args);
    results.set(key, { value });
    return value;
  };
}
