import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { queryClient } from './query-client';
import { endSession } from './session-end';

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  queryClient.clear();
});

describe('endSession', () => {
  it('清空会话和查询缓存', () => {
    useSessionStore().start({
      token: createTestJwtExpiringAt(Date.now() + 3_600_000),
      user: { loginName: 'zhangsan', role: Role.user }
    });
    queryClient.setQueryData(['files'], ['上一个账号的数据']);

    endSession();

    expect(useSessionStore().session).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('取消进行中的查询', async () => {
    let signal: AbortSignal | undefined;
    // 请求一直不返回；被取消后这个 Promise 以取消错误结束
    void queryClient
      .query({
        queryKey: ['files'],
        queryFn: context => {
          signal = context.signal;
          return new Promise(() => undefined);
        }
      })
      .catch(() => undefined);
    await Promise.resolve();

    endSession();

    expect(signal?.aborted).toBe(true);
  });
});
