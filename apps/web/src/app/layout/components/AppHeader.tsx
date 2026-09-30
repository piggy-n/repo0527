import { defineComponent } from 'vue';
import { SystemTitle } from '@/shared/system-title/SystemTitle';
import logo from '../images/header-logo.webp';
import styles from './AppHeader.module.scss';
import { HeaderNav } from './HeaderNav';
import { UserMenu } from './UserMenu';

/** 顶部栏：Logo 与系统名称、导航、用户菜单；宽度适配见 docs/modules/layout.md */
export const AppHeader = defineComponent({
  name: 'AppHeader',
  setup() {
    return () => (
      <header class={styles.root}>
        <div class={styles.brand}>
          <img class={styles.logo} src={logo} alt="一张图（江苏）" />
          <div class={styles.title}>
            <SystemTitle />
          </div>
        </div>
        <HeaderNav />
        <div class={styles.user}>
          <UserMenu />
        </div>
      </header>
    );
  }
});
