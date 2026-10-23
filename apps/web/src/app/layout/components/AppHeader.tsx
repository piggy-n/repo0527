import { useElementBounding } from '@vueuse/core';
import { defineComponent, ref, type SlotsType, type VNode } from 'vue';
import { SystemTitle } from '@/shared/system-title/SystemTitle';
import logo from '../images/header-logo.webp';
import styles from './AppHeader.module.scss';
import { HeaderNav } from './HeaderNav';
import { UserMenu } from './UserMenu';

export interface HeaderActions {
  headerBottom: number;
}

/** 顶部栏：Logo 与系统名称、导航、用户菜单；宽度适配见 docs/modules/layout.md */
export const AppHeader = defineComponent({
  name: 'AppHeader',
  slots: Object as SlotsType<{ actions?: (props: HeaderActions) => VNode[] }>,
  setup(_props, { slots }) {
    const header = ref<HTMLElement>();
    const { bottom } = useElementBounding(header);
    return () => (
      <header ref={header} class={styles.root}>
        <div class={styles.brand}>
          <img class={styles.logo} src={logo} alt="一张图（江苏）" />
          <div class={styles.title}>
            <SystemTitle />
          </div>
        </div>
        <HeaderNav />
        <div class={styles.user}>
          {slots.actions?.({ headerBottom: bottom.value })}
          <UserMenu />
        </div>
      </header>
    );
  }
});
