import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { Role } from '@/shared/auth/roles';
import { routes } from '../../router/routes';
import { type NavItem, navItems, visibleNavItems } from '../menus';
import { CompactNav } from './CompactNav';

// 打开下拉菜单，返回菜单中每一行的类型与文字；菜单内容渲染在 body 下
async function openMenu(role: Role, path: string, pick: (items: NavItem[]) => NavItem[] = items => items) {
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(path);
  const items = pick(visibleNavItems(navItems, role, name => router.resolve({ name }).meta.roles));
  const wrapper = mount(CompactNav, { props: { items }, global: { plugins: [router] }, attachTo: document.body });
  await wrapper.find('button').trigger('click');
  await vi.waitFor(() => expect(document.querySelector('.el-dropdown-menu')).not.toBeNull());

  const rows = [...(document.querySelector('.el-dropdown-menu')?.children ?? [])].map(row => {
    const text = row.textContent?.trim() ?? '';
    if (row.getAttribute('role') === 'separator') {
      return '——';
    }
    if (row.getAttribute('role') === 'presentation') {
      return row.querySelector('svg') ? `[标题+图标] ${text}` : `[分组] ${text}`;
    }
    const indent = row.className.includes('_compactNested_') ? '  ' : '';
    const icon = row.querySelector('svg') ? '[图标] ' : '';
    const active = row.className.includes('_compactActive_') ? ' (当前)' : '';
    return `${indent}${icon}${text}${active}`;
  });
  return rows;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('CompactNav', () => {
  it('一级项带图标；查询统计自成一块，前后有分隔线，子页面缩进；标出当前页', async () => {
    expect(await openMenu(Role.admin, '/land-change-query')).toEqual([
      '[图标] 资源管理',
      '[图标] 现状底图',
      '——',
      '[标题+图标] 查询统计',
      '[分组] 数据查询',
      '  国土变更调查 (当前)',
      '  城市国土空间监测',
      '  森林草原湿地荒漠调查监测',
      '  水资源基础调查',
      '[分组] 专项统计',
      '  城市国土空间监测基本统计',
      '  城市国土空间监测指标',
      '——',
      '[图标] 文件管理',
      '[图标] 系统管理',
      '[图标] AI对话'
    ]);
  });

  it('下拉项在第一项或最后一项时，外侧不加分隔线', async () => {
    const rows = await openMenu(Role.user, '/current-map', items => items.filter(item => item.kind === 'dropdown'));

    expect(rows.at(0)).toBe('[标题+图标] 查询统计');
    expect(rows.at(-1)).toBe('  城市国土空间监测指标');
  });
});
