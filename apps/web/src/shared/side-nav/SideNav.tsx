import { useSplitLayout } from '@yzt/ui';
import { defineComponent, type PropType } from 'vue';
import { RouterLink } from 'vue-router';
import { type IconName, SvgIcon } from '../icons/SvgIcon';
import type { RouteName } from '../router/route-names';
import styles from './SideNav.module.scss';

export interface SideNavItem {
  label: string;
  icon: IconName;
  route: RouteName;
}

/**
 * 菜单型左栏的页面内导航（ADR 0091）：菜单项是 RouterLink，能用 Tab 聚焦、回车打开、在新标签页打开；
 * 当前页由 RouterLink 判断（不看查询参数），加 aria-current。放在 MxSplitLayout 的侧栏里，窄屏时在抽屉里点了就关闭抽屉
 */
export const SideNav = defineComponent({
  name: 'SideNav',
  props: {
    // 导航的无障碍名称，一般是页面名
    label: { type: String, required: true },
    items: { type: Array as PropType<readonly SideNavItem[]>, required: true }
  },
  setup(props) {
    const { compact, closeAside } = useSplitLayout();

    function closeDrawer() {
      if (compact.value) {
        closeAside();
      }
    }

    return () => (
      <nav class={styles.root} aria-label={props.label}>
        <ul class={styles.list}>
          {props.items.map(item => (
            <li key={item.route}>
              <RouterLink
                to={{ name: item.route }}
                class={styles.item}
                exactActiveClass={styles.active}
                onClick={closeDrawer}
              >
                <SvgIcon class={styles.icon} name={item.icon} size={18} />
                <span class={styles.label}>{item.label}</span>
              </RouterLink>
            </li>
          ))}
        </ul>
      </nav>
    );
  }
});
