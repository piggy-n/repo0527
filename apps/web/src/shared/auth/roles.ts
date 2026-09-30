import { RouteName } from '../router/route-names';

/** 系统角色，值与后端的 roleCode 相同 */
export const Role = {
  admin: 'admin',
  user: 'user'
} as const;

export type Role = (typeof Role)[keyof typeof Role];

function isRole(value: unknown): value is Role {
  return value === Role.admin || value === Role.user;
}

/** 后端的 roleCode 转成系统角色；缺失或无法识别时按普通用户处理，与旧项目一致 */
export function toRole(roleCode: unknown): Role {
  return isRole(roleCode) ? roleCode : Role.user;
}

const roleLabels: Record<Role, string> = {
  admin: '管理员',
  user: '普通用户'
};

/** 角色的显示名 */
export function roleLabel(role: Role): string {
  return roleLabels[role];
}

/** 角色能否访问限定了 allowed 的页面或功能；allowed 为空表示不限角色 */
export function canAccess(role: Role, allowed: readonly Role[] | undefined): boolean {
  return allowed === undefined || allowed.includes(role);
}

// Record 要求每个角色都有首页，新增角色时漏配会报类型错误
const roleHomes: Record<Role, RouteName> = {
  admin: RouteName.currentMap,
  user: RouteName.currentMap
};

/** 角色登录后进入的页面，也是访问无权限页面时的去处 */
export function roleHome(role: Role): RouteName {
  return roleHomes[role];
}
