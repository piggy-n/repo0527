import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDeviceStore } from './device-store';

const markSchema = z.object({ tier: z.enum(['low', 'standard', 'high']) });

afterEach(() => {
  localStorage.clear();
});

// 读写都抛错的存储：浏览器禁用存储时
const brokenStorage = {
  get length(): number {
    throw new Error('禁用');
  },
  getItem() {
    throw new Error('禁用');
  },
  setItem() {
    throw new Error('禁用');
  },
  removeItem() {
    throw new Error('禁用');
  },
  key() {
    throw new Error('禁用');
  },
  clear() {
    throw new Error('禁用');
  }
} as Storage;

describe('createDeviceStore', () => {
  it('同步写进 localStorage，读出时按 schema 校验；键带自己的前缀，和别的数据分开', () => {
    const store = createDeviceStore(localStorage);
    store.set('scene-tier:page:a1', { tier: 'high' });
    expect(store.get('scene-tier:page:a1', markSchema)).toEqual({ tier: 'high' });
    expect(localStorage.getItem('yzt.device.scene-tier:page:a1')).toBe('{"tier":"high"}');
    store.remove('scene-tier:page:a1');
    expect(store.get('scene-tier:page:a1', markSchema)).toBeUndefined();
  });

  it('不合法的值读出时当作没有，顺手删掉', () => {
    const store = createDeviceStore(localStorage);
    localStorage.setItem('yzt.device.broken', '{not json');
    localStorage.setItem('yzt.device.other', '{"tier":"ultra"}');
    expect(store.get('broken', markSchema)).toBeUndefined();
    expect(store.get('other', markSchema)).toBeUndefined();
    expect(localStorage.getItem('yzt.device.broken')).toBeNull();
    expect(localStorage.getItem('yzt.device.other')).toBeNull();
  });

  it('按前缀列出键：只列自己的，不带存储的前缀', () => {
    const store = createDeviceStore(localStorage);
    store.set('scene-tier:page:a1', { tier: 'high' });
    store.set('scene-tier:page:b2', { tier: 'standard' });
    store.set('scene-tier:cap', { tier: 'standard' });
    localStorage.setItem('yzt.session', '{}');
    expect(store.keys('scene-tier:page:').toSorted()).toEqual(['scene-tier:page:a1', 'scene-tier:page:b2']);
  });

  it('浏览器禁用存储、没有存储时读写都安静地失败', () => {
    for (const storage of [brokenStorage, null]) {
      const store = createDeviceStore(storage);
      expect(() => store.set('a', { tier: 'low' })).not.toThrow();
      expect(store.get('a', markSchema)).toBeUndefined();
      expect(() => store.remove('a')).not.toThrow();
      expect(store.keys('')).toEqual([]);
    }
  });
});
