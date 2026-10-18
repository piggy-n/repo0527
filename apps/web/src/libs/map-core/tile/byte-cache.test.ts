// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ByteCache } from './byte-cache';

describe('瓦片字节缓存', () => {
  it('命中刷新最近使用顺序，淘汰真正最久未访问的条目', () => {
    const cache = new ByteCache<string, number>(10);
    cache.set('a', 1, 4);
    cache.set('b', 2, 4);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3, 4);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.bytes).toBe(8);
  });

  it('替换同名条目只计算新占用，删除和清空同时释放预算', () => {
    const cache = new ByteCache<string, number>(10);
    cache.set('a', 1, 4);
    cache.set('a', 2, 7);
    expect(cache.bytes).toBe(7);
    expect(cache.size).toBe(1);
    cache.delete('missing');
    cache.delete('a');
    expect(cache.bytes).toBe(0);
    cache.set('b', 3, 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });

  it('超大条目不驻留，也不会挤掉其他仍有用的小条目', () => {
    const cache = new ByteCache<string, number>(10);
    cache.set('small', 1, 4);
    cache.set('large', 2, 11);
    expect(cache.get('large')).toBeUndefined();
    expect(cache.get('small')).toBe(1);
    expect(cache.bytes).toBe(4);
    const disabled = new ByteCache<string, number>(0);
    disabled.set('empty', 1, 0);
    expect(disabled.size).toBe(0);
  });

  it('非法预算和占用不破坏已有缓存', () => {
    expect(() => new ByteCache(-1)).toThrow(RangeError);
    const cache = new ByteCache<string, number>(10);
    cache.set('a', 1, 2);
    expect(() => cache.set('a', 2, NaN)).toThrow(RangeError);
    expect(cache.get('a')).toBe(1);
  });
});
