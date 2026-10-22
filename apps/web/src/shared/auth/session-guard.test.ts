// @vitest-environment node
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { Role } from './roles';
import { useSessionGuard } from './session-guard';
import { useSessionStore } from './session-store';
import { createTestJwtExpiringAt } from './testing';

const NOW = Date.UTC(2026, 8, 29, 12);

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('useSessionGuard', () => {
  it('同一会话通过核对；换成另一个会话或退出后不通过', () => {
    const session = useSessionStore();
    session.start({ token: createTestJwtExpiringAt(NOW + 3_600_000), user: { loginName: 'a', role: Role.admin } });
    const guard = useSessionGuard();
    const token = guard.capture();

    expect(guard.isCurrent(token)).toBe(true);
    expect(() => guard.assertCurrent(token)).not.toThrow();

    session.start({ token: createTestJwtExpiringAt(NOW + 7_200_000), user: { loginName: 'a', role: Role.admin } });
    expect(guard.isCurrent(token)).toBe(false);
    expect(() => guard.assertCurrent(token)).toThrow(expect.objectContaining({ kind: 'canceled' }));

    const renewed = guard.capture();
    session.clear();
    expect(guard.isCurrent(renewed)).toBe(false);
  });

  it('未登录时记下的是 undefined，之后登录也不算同一会话', () => {
    const guard = useSessionGuard();
    const token = guard.capture();
    expect(token).toBeUndefined();

    useSessionStore().start({ token: createTestJwtExpiringAt(NOW + 3_600_000), user: { loginName: 'a', role: Role.user } });
    expect(guard.isCurrent(token)).toBe(false);
  });

  it('只是过期不算换会话：过期由 shared/http 在发请求前统一处理', () => {
    const session = useSessionStore();
    session.start({ token: createTestJwtExpiringAt(NOW - 1000), user: { loginName: 'a', role: Role.user } });
    const guard = useSessionGuard();
    expect(session.isActive(NOW)).toBe(false);
    expect(guard.isCurrent(guard.capture())).toBe(true);
  });
});
