import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { canAccess, Role } from '@/shared/auth/roles';
import { routes } from '../router/routes';
import { messageLocation } from './message-routes';

// 用真实的路由表：只解析地址和 meta，不加载页面
const router = createRouter({ history: createMemoryHistory(), routes });

describe('messageLocation', () => {
  it('管理员：申请在系统管理里用 ?apply= 打开，报表是统计报表栏目', () => {
    expect(router.resolve(messageLocation({ kind: 'application', applyId: 'apply 1' }, Role.admin)).fullPath).toBe(
      '/system-management?apply=apply+1'
    );
    expect(router.resolve(messageLocation({ kind: 'reports' }, Role.admin)).fullPath).toBe(
      '/system-management/statistical-report'
    );
  });

  it('普通用户：申请在数据下载里用 ?apply= 打开，报表是统计报表栏目', () => {
    expect(router.resolve(messageLocation({ kind: 'application', applyId: 'apply 1' }, Role.user)).fullPath).toBe(
      '/resource-application?apply=apply+1'
    );
    expect(router.resolve(messageLocation({ kind: 'reports' }, Role.user)).fullPath).toBe(
      '/resource-application/statistical-report'
    );
  });

  it('每种角色去的页面都是它能访问的，不会被路由守卫挡回首页', () => {
    for (const role of [Role.admin, Role.user]) {
      for (const target of [{ kind: 'application', applyId: 'apply-1' }, { kind: 'reports' }] as const) {
        expect(canAccess(role, router.resolve(messageLocation(target, role)).meta.roles)).toBe(true);
      }
    }
  });
});
