import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { Role } from '@/shared/auth/roles';
import { routes } from '../router/routes';
import { messageLocation } from './message-routes';

// 用真实的路由表：只解析地址和 meta，不加载页面
const router = createRouter({ history: createMemoryHistory(), routes });

describe('messageLocation', () => {
  it('申请在系统管理里用 ?apply= 打开，报表是统计报表栏目', () => {
    expect(router.resolve(messageLocation({ kind: 'application', applyId: 'apply 1' })).fullPath).toBe(
      '/system-management?apply=apply+1'
    );
    expect(router.resolve(messageLocation({ kind: 'reports' })).fullPath).toBe('/system-management/statistical-report');
  });

  it('两种目标都只有管理员能去（普通用户的"数据下载"还没有迁移）', () => {
    for (const target of [{ kind: 'application', applyId: 'apply-1' }, { kind: 'reports' }] as const) {
      expect(router.resolve(messageLocation(target)).meta.roles).toEqual([Role.admin]);
    }
  });
});
