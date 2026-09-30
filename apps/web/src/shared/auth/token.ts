import { InvalidTokenError, jwtDecode } from 'jwt-decode';
import { z } from 'zod';

// 提前 30 秒视为过期，避免请求发出时 token 恰好失效
const EXPIRY_MARGIN = 30_000;

// jwtDecode 只保证载荷能按 JSON 解析，结果可能是 null、数字等，类型声明并不可靠
const payloadSchema = z.object({ exp: z.number() });

/** token 的过期时间（毫秒时间戳）；不是 JWT 或没有 exp 时返回 undefined */
export function getTokenExpiry(token: string): number | undefined {
  try {
    const payload = payloadSchema.safeParse(jwtDecode(token));
    return payload.success ? payload.data.exp * 1000 : undefined;
  } catch (error) {
    if (error instanceof InvalidTokenError) {
      return undefined;
    }
    throw error;
  }
}

/** 在本地判断 token 是否过期，不校验签名；无法得知过期时间时视为未过期，由后端返回的 401 兜底 */
export function isTokenExpired(token: string, now = Date.now()): boolean {
  const expiry = getTokenExpiry(token);
  return expiry !== undefined && now >= expiry - EXPIRY_MARGIN;
}
