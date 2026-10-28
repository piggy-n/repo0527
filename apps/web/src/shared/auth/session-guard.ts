import { ApiError } from '../http/errors';
import { useSessionStore } from './session-store';

/** 会话核对的三个操作，需要替换的地方（如组件样例）按它实现 */
export type SessionGuard = ReturnType<typeof useSessionGuard>;

/**
 * 服务端写操作的会话核对（AGENTS.md"接口请求"）：提交时记下 token，mutationFn 发请求前 assertCurrent，响应后 isCurrent。
 * 退出、换账号、其他标签页重新登录都会换掉 token；只是过期不算，下一个请求由 shared/http 按登录过期统一处理
 */
export function useSessionGuard() {
  const session = useSessionStore();

  /** 提交时调用；未登录时为 undefined，之后的核对都不通过 */
  const capture = (): string | undefined => session.token;

  /** 会话仍是提交时的那一个 */
  const isCurrent = (token: string | undefined): boolean => token !== undefined && session.token === token;

  /** 会话已变时以 canceled 结束：不用新会话的凭据发送旧会话的操作，被取消的请求不提示 */
  function assertCurrent(token: string | undefined): void {
    if (!isCurrent(token)) {
      throw new ApiError({ kind: 'canceled', message: '会话已变更' });
    }
  }

  return { capture, isCurrent, assertCurrent };
}
