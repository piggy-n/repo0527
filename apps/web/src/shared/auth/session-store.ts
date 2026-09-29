import { acceptHMRUpdate, defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { z } from 'zod';
import { Role } from './roles';
import { isTokenExpired } from './token';

const STORAGE_KEY = 'yzt.session';

// localStorage 中的数据来自浏览器，读取时按 schema 校验；类型也由它推断
const sessionSchema = z.object({
  token: z.string().min(1),
  user: z.object({
    id: z.string().optional(),
    loginName: z.string(),
    realName: z.string().optional(),
    avatar: z.string().optional(),
    role: z.enum(Role)
  })
});

export type Session = z.infer<typeof sessionSchema>;
export type SessionUser = Session['user'];

function saveSession(session: Session | null): void {
  try {
    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // 浏览器禁用存储或空间已满时，会话只保存在内存中
  }
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = sessionSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // JSON 已损坏，或浏览器禁用了存储
  }
  // 丢弃无法使用的数据，例如结构不同的旧版本数据
  saveSession(null);
  return null;
}

/** 登录会话：token 与当前用户，保存在 localStorage，刷新页面后仍然有效 */
export const useSessionStore = defineStore('session', () => {
  const session = ref<Session | null>(loadSession());

  const token = computed(() => session.value?.token);
  const user = computed(() => session.value?.user);
  // 真实姓名可能是空字符串，所以用 || 而不是 ??
  const displayName = computed(() => (user.value ? user.value.realName || user.value.loginName : ''));

  /** 已登录且 token 未过期；结果随时间变化，所以是方法而不是 computed */
  function isActive(now = Date.now()): boolean {
    return session.value !== null && !isTokenExpired(session.value.token, now);
  }

  function start(next: Session): void {
    session.value = next;
    saveSession(next);
  }

  /** 退出登录或登录过期时清空 */
  function clear(): void {
    session.value = null;
    saveSession(null);
  }

  return { session, token, user, displayName, isActive, start, clear };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSessionStore, import.meta.hot));
}
