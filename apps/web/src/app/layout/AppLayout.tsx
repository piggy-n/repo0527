import { defineComponent, KeepAlive, type VNode } from 'vue';
import { type RouteLocationNormalizedLoaded, RouterView } from 'vue-router';
import styles from './AppLayout.module.scss';
import { AppHeader, type HeaderActions } from './components/AppHeader';
import { HeaderMessages } from './components/HeaderMessages';

interface RouterViewSlotProps {
  readonly Component: VNode | undefined;
  readonly route: RouteLocationNormalizedLoaded;
}

/**
 * 业务页面共用的布局：顶部栏加内容区，内容区占满剩余高度。
 * 路由 meta 写了 keepAlive 的页面放进常驻的 KeepAlive，切到别的页面时缓存（ADR 0063）；布局卸载时缓存跟着清空
 */
export const AppLayout = defineComponent({
  name: 'AppLayout',
  setup() {
    return () => (
      <div class={styles.root}>
        <AppHeader>
          {{ actions: ({ headerBottom }: HeaderActions) => <HeaderMessages headerBottom={headerBottom} /> }}
        </AppHeader>
        <main class={styles.main}>
          <RouterView>
            {{
              default: ({ Component, route }: RouterViewSlotProps) => [
                <KeepAlive>{route.meta.keepAlive ? Component : null}</KeepAlive>,
                route.meta.keepAlive ? null : Component
              ]
            }}
          </RouterView>
        </main>
      </div>
    );
  }
});
