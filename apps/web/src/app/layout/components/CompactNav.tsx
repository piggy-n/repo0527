import { Menu } from '@element-plus/icons-vue';
import { ElDropdown, ElDropdownItem, ElDropdownMenu, ElIcon } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { type IconName, SvgIcon } from '@/shared/icons/SvgIcon';
import type { NavDropdown, NavItem, NavLinkTarget } from '../menus';
import styles from './HeaderNav.module.scss';

const divider = (key: string) => <li key={key} role="separator" class={styles.compactDivider} />;

/** 窄屏导航：全部页面收进一个下拉菜单；一级项带图标，下拉项（如"查询统计"）自成一块，前后加分隔线，子页面缩进 */
export const CompactNav = defineComponent({
  name: 'CompactNav',
  props: {
    items: { type: Array as PropType<NavItem[]>, required: true }
  },
  setup(props) {
    const router = useRouter();
    const route = useRoute();

    // 一级项传入图标；子页面不带图标，靠缩进表示层级
    const link = ({ label, route: target }: NavLinkTarget, icon?: IconName) => (
      <ElDropdownItem
        key={target}
        class={[!icon && styles.compactNested, target === route.name && styles.compactActive]}
        onClick={() => void router.push({ name: target })}
      >
        {icon && <SvgIcon class={styles.compactIcon} name={icon} size={16} />}
        {label}
      </ElDropdownItem>
    );

    const section = (item: NavDropdown, index: number) => [
      ...(index > 0 ? [divider(`${item.label}-before`)] : []),
      <li key={item.label} role="presentation" class={styles.compactHeader}>
        <SvgIcon class={styles.compactIcon} name={item.icon} size={16} />
        {item.label}
      </li>,
      ...item.groups.flatMap(group => [
        <li key={group.label} role="presentation" class={styles.compactGroup}>
          {group.label}
        </li>,
        ...group.links.map(target => link(target))
      ]),
      ...(index < props.items.length - 1 ? [divider(`${item.label}-after`)] : [])
    ];

    return () => (
      <ElDropdown class={styles.compact} trigger="click" placement="bottom-end">
        {{
          default: () => (
            <button type="button" class={styles.item}>
              <ElIcon>
                <Menu />
              </ElIcon>
              菜单
            </button>
          ),
          dropdown: () => (
            <ElDropdownMenu>
              {props.items.flatMap((item, index) => (item.kind === 'link' ? [link(item, item.icon)] : section(item, index)))}
            </ElDropdownMenu>
          )
        }}
      </ElDropdown>
    );
  }
});
