import { describe, expect, it } from 'vitest';
import { createTestJwt, createTestJwtExpiringAt } from './testing';
import { getTokenExpiry, isTokenExpired } from './token';

const NOW = Date.UTC(2026, 8, 29, 12);

describe('getTokenExpiry', () => {
  it('返回 exp 对应的毫秒时间戳', () => {
    expect(getTokenExpiry(createTestJwt({ exp: 1_790_000_000 }))).toBe(1_790_000_000_000);
  });

  it('载荷含中文时也能解析', () => {
    expect(getTokenExpiry(createTestJwt({ name: '张三', exp: 1_790_000_000 }))).toBe(1_790_000_000_000);
  });

  it('没有 exp 或 exp 不是数字时返回 undefined', () => {
    expect(getTokenExpiry(createTestJwt({ sub: 'u1' }))).toBeUndefined();
    expect(getTokenExpiry(createTestJwt({ exp: '1790000000' }))).toBeUndefined();
  });

  it('不是 JWT 时返回 undefined，不抛错', () => {
    expect(getTokenExpiry('plain-token')).toBeUndefined();
    expect(getTokenExpiry('a.%%%.c')).toBeUndefined();
  });
});

describe('isTokenExpired', () => {
  it('提前 30 秒视为过期', () => {
    expect(isTokenExpired(createTestJwtExpiringAt(NOW + 60_000), NOW)).toBe(false);
    expect(isTokenExpired(createTestJwtExpiringAt(NOW + 20_000), NOW)).toBe(true);
    expect(isTokenExpired(createTestJwtExpiringAt(NOW - 1000), NOW)).toBe(true);
  });

  it('无法得知过期时间时视为未过期', () => {
    expect(isTokenExpired('plain-token', NOW)).toBe(false);
    expect(isTokenExpired(createTestJwt({ sub: 'u1' }), NOW)).toBe(false);
  });
});
