import { DataAnalysis, Tickets } from '@element-plus/icons-vue';
import { useSplitLayout } from '@yzt/ui';
import { ElIcon, ElMenu, ElMenuItem } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import styles from './preview.module.scss';
import type { MenuStyle, SystemSection } from './useSystemManagementDemo';

interface MenuItem {
  key: SystemSection;
  label: string;
  icon: typeof Tickets;
}

const ITEMS: MenuItem[] = [
  { key: 'audit', label: '资源审核', icon: Tickets },
  { key: 'reports', label: '统计报表', icon: DataAnalysis }
];

const isSection = (key: string): key is SystemSection => ITEMS.some(item => item.key === key);

/**
 * 系统管理的页面内菜单，两种候选写法：ElMenu 加 element-theme.scss 的 menu-side 变体，或自己写的列表（MxSideMenu 的原型）。
 * 正式页面的菜单项是路由，这里只切换栏目；窄屏时在抽屉里选中一项后关闭抽屉
 */
export const SystemMenuPreview = defineComponent({
  name: 'SystemMenuPreview',
  props: {
    menuStyle: { type: String as PropType<MenuStyle>, required: true },
    active: { type: String as PropType<SystemSection>, required: true }
  },
  emits: {
    select: (_section: SystemSection) => true
  },
  setup(props, { emit }) {
    const { compact, closeAside } = useSplitLayout();

    function select(key: string) {
      if (!isSection(key)) {
        return;
      }
      emit('select', key);
      if (compact.value) {
        closeAside();
      }
    }

    function renderElMenu() {
      return (
        <ElMenu class="menu-side" defaultActive={props.active} onSelect={select}>
          {ITEMS.map(item => (
            <ElMenuItem key={item.key} index={item.key}>
              <ElIcon>
                <item.icon />
              </ElIcon>
              <span>{item.label}</span>
            </ElMenuItem>
          ))}
        </ElMenu>
      );
    }

    // MxSideMenu 的原型：libs/ui 不能用路由和 SvgIcon，正式组件的菜单项由使用方渲染成链接
    function renderSideMenu() {
      return (
        <nav aria-label="系统管理">
          <ul class={styles.sideMenu}>
            {ITEMS.map(item => (
              <li key={item.key}>
                <button
                  type="button"
                  class={[styles.sideMenuItem, item.key === props.active && styles.sideMenuItemActive]}
                  aria-current={item.key === props.active ? 'page' : undefined}
                  onClick={() => select(item.key)}
                >
                  <ElIcon size={18}>
                    <item.icon />
                  </ElIcon>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      );
    }

    return () => <div class={styles.menu}>{props.menuStyle === 'el-menu' ? renderElMenu() : renderSideMenu()}</div>;
  }
});
