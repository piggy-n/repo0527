import { DataAnalysis, Tickets } from '@element-plus/icons-vue';
import { useSplitLayout } from '@yzt/ui';
import { ElIcon } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import styles from './preview.module.scss';
import type { SystemSection } from './useSystemManagementDemo';

interface MenuItem {
  key: SystemSection;
  label: string;
  icon: typeof Tickets;
}

const ITEMS: MenuItem[] = [
  { key: 'audit', label: '资源审核', icon: Tickets },
  { key: 'reports', label: '统计报表', icon: DataAnalysis }
];

/**
 * 系统管理的页面内菜单（ADR 0092 的 SideNav 的外观）。正式组件的菜单项是 RouterLink，这里只切换栏目；
 * 窄屏时在抽屉里选中一项后关闭抽屉
 */
export const SystemMenuPreview = defineComponent({
  name: 'SystemMenuPreview',
  props: {
    active: { type: String as PropType<SystemSection>, required: true }
  },
  emits: {
    select: (_section: SystemSection) => true
  },
  setup(props, { emit }) {
    const { compact, closeAside } = useSplitLayout();

    function select(key: SystemSection) {
      emit('select', key);
      if (compact.value) {
        closeAside();
      }
    }

    return () => (
      <nav class={styles.menu} aria-label="系统管理">
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
});
