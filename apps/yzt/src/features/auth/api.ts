import { z } from 'zod';
import { toRole } from '@/shared/auth/roles';
import type { Session } from '@/shared/auth/session-store';
import { appConfig } from '@/shared/config/app-config';
import { http } from '@/shared/http/client';
import { encryptPassword } from './password';

// 登录响应的 data。后端接口文档登录后才能查看，字段按旧项目的用法确定（ADR 0015）；Java 后端缺省的字段可能是 null
const loginResultSchema = z.object({
  token: z.string().min(1),
  roleCode: z.string(),
  id: z.union([z.string(), z.number().transform(String)]).nullish(),
  loginName: z.string().nullish(),
  // 旧项目在 loginName 缺失时读取 username
  username: z.string().nullish(),
  realName: z.string().nullish(),
  avatar: z.string().nullish()
});

type LoginResult = z.output<typeof loginResultSchema>;

export interface LoginCredentials {
  loginName: string;
  password: string;
}

// 转换成会话结构，应用的其他部分不接触后端的字段名
function toSession(result: LoginResult, inputLoginName: string): Session {
  const { token, roleCode, id, loginName, username, realName, avatar } = result;
  return {
    token,
    user: {
      id: id ?? undefined,
      // 后端可能返回空字符串，所以用 || 而不是 ??
      loginName: loginName || username || inputLoginName,
      realName: realName ?? undefined,
      avatar: avatar ?? undefined,
      role: toRole(roleCode)
    }
  };
}

/** 登录：密码用 SM2 加密后提交，返回可以直接保存的会话；失败时不弹全局提示，由登录表单显示 */
export async function login({ loginName, password }: LoginCredentials, signal?: AbortSignal): Promise<Session> {
  const result = await http.post(
    '/user/login',
    { loginName, password: encryptPassword(password, appConfig.loginPublicKey) },
    { schema: loginResultSchema, signal, silent: true }
  );
  return toSession(result, loginName);
}
