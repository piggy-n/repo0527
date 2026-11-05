/** 按键得到 [0, 1) 的固定伪随机数：同样的键永远同一个数；混合散列打散相邻编码之间的相关性 */
export function stableRandom(key: string): number {
  let hash = 2166136261;
  for (const character of key) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}
