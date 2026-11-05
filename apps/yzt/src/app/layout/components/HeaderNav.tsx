import { computed, defineComponent } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '@/shared/auth/session-store';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { isNavItemActive, navItems, visibleNavItems } from '../menus';
import { CompactNav } from './CompactNav';
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
                <SvgIcon class={styles.icon} name={item.icon} size={20} />
                {item.label}
              </RouterLink>
            ) : (
              <NavDropdown key={item.label} item={item} />
            )
          )}
        </div>
        <CompactNav items={items.value} />
      </nav>
    );
  }
});
