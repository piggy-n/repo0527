import { defineComponent, KeepAlive, type VNode } from 'vue';
import { type RouteLocationNormalizedLoaded, RouterView } from 'vue-router';
import { appConfig } from '@/shared/config/app-config';
import styles from './AppLayout.module.scss';
import { AppHeader } from './components/AppHeader';

interface RouterViewSlotProps {
  readonly Component: VNode | undefined;
  readonly route: RouteLocationNormalizedLoaded;
}

/**
 * 业务页面共用的布局：顶部栏加内容区，内容区占满剩余高度。
 * 路由 meta 写了 keepAlive 的页面放进常驻的 KeepAlive，切到别的页面时缓存（ADR 0063）；布局卸载时缓存跟着清空。
 * 打开"离开页面后重置"（VITE_PAGE_STATE_RESET）时不缓存，每次进入都重新创建（ADR 0114）
 */
export const AppLayout = defineComponent({
  name: 'AppLayout',
  props: {
    /** 离开页面后重置；路由渲染时不传，取环境变量 */
    pageStateReset: { type: Boolean, default: () => appConfig.pageStateReset }
  },
  setup(props) {
    const cached = (route: RouteLocationNormalizedLoaded) => route.meta.keepAlive === true && !props.pageStateReset;
    return () => (
      <div class={styles.root}>
        <AppHeader />
        <main class={styles.main}>
          <RouterView>
            {{
              default: ({ Component, route }: RouterViewSlotProps) => [
                <KeepAlive>{cached(route) ? Component : null}</KeepAlive>,
                cached(route) ? null : Component
              ]
            }}
          </RouterView>
        </main>
      </div>
    );
  }
});
