// 只供测试使用

function toBase64Url(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** 生成测试用的 JWT：头和载荷是真实编码，签名是假的（前端不校验签名） */
export function createTestJwt(payload: Record<string, unknown>): string {
  return `${toBase64Url({ alg: 'HS256', typ: 'JWT' })}.${toBase64Url(payload)}.signature`;
}

/** 生成 exp 为指定毫秒时间戳的测试 JWT */
export function createTestJwtExpiringAt(expiresAt: number): string {
  return createTestJwt({ sub: 'test', exp: Math.floor(expiresAt / 1000) });
}
