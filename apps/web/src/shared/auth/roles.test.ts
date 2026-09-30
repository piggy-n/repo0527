import { describe, expect, it } from 'vitest';
import { RouteName } from '../router/route-names';
import { canAccess, Role, roleHome, toRole } from './roles';

describe('toRole', () => {
  it('识别 admin 和 user', () => {
    expect(toRole('admin')).toBe(Role.admin);
    expect(toRole('user')).toBe(Role.user);
  });

  it('缺失或无法识别时按普通用户处理', () => {
    expect(toRole(undefined)).toBe(Role.user);
    expect(toRole(null)).toBe(Role.user);
    expect(toRole('Admin')).toBe(Role.user);
    expect(toRole('superadmin')).toBe(Role.user);
  });
});

describe('canAccess', () => {
  it('没有限定角色时都能访问', () => {
    expect(canAccess(Role.user, undefined)).toBe(true);
  });

  it('限定角色时只有列出的角色能访问', () => {
    expect(canAccess(Role.admin, [Role.admin])).toBe(true);
    expect(canAccess(Role.user, [Role.admin])).toBe(false);
    expect(canAccess(Role.admin, [])).toBe(false);
  });
});

describe('roleHome', () => {
  it('两种角色都进入现状底图', () => {
    expect(roleHome(Role.admin)).toBe(RouteName.currentMap);
    expect(roleHome(Role.user)).toBe(RouteName.currentMap);
  });
});
