import { Menu } from '@element-plus/icons-vue';
import { ElDropdown, ElDropdownItem, ElDropdownMenu, ElIcon } from 'element-plus';
import { computed, defineComponent, h } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '@/shared/auth/session-store';
import type { RouteName } from '@/shared/router/route-names';
import { isNavItemActive, type NavLinkTarget, navItems, visibleNavItems } from '../menus';
import styles from './HeaderNav.module.scss';
import { NavDropdown } from './NavDropdown';

/** 顶部导航：按当前角色过滤；宽度不够时收进"菜单"下拉（断点见 _breakpoints.scss） */
export const HeaderNav = defineComponent({
  name: 'HeaderNav',
  setup() {
    const router = useRouter();
    const route = useRoute();
    const session = useSessionStore();

    // 页面允许的角色从路由的 meta.roles 读取，菜单不另外维护一份权限
    const items = computed(() => {
      const role = session.user?.role;
      return role ? visibleNavItems(navItems, role, name => router.resolve({ name }).meta.roles) : [];
    });

    const go = (name: RouteName) => {
      void router.push({ name });
    };

    // 窄屏菜单中的一个页面
    const compactItem = ({ label, route: target }: NavLinkTarget) => (
      <ElDropdownItem
        key={target}
        class={target === route.name ? styles.compactActive : undefined}
        onClick={() => go(target)}
      >
        {label}
      </ElDropdownItem>
    );

    return () => (
      <nav class={styles.nav}>
        <div class={styles.desktop}>
          {items.value.map(item =>
            item.kind === 'link' ? (
              <RouterLink
                key={item.route}
                to={{ name: item.route }}
                class={[styles.item, isNavItemActive(item, route.name) && styles.active]}
              >
                <ElIcon class={styles.icon}>{h(item.icon)}</ElIcon>
                {item.label}
              </RouterLink>
            ) : (
              <NavDropdown key={item.label} item={item} />
            )
          )}
        </div>
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
                {items.value.flatMap(item =>
                  item.kind === 'link'
                    ? [compactItem(item)]
                    : item.groups.flatMap(group => [
                        <div key={group.label} class={styles.compactGroup}>
                          {item.label} / {group.label}
                        </div>,
                        ...group.links.map(compactItem)
                      ])
                )}
              </ElDropdownMenu>
            )
          }}
        </ElDropdown>
      </nav>
    );
  }
});
