import { defineComponent } from 'vue';
import { RouterView } from 'vue-router';
import styles from './AppLayout.module.scss';
import { AppHeader } from './components/AppHeader';

/** 业务页面共用的布局：顶部栏加内容区，内容区占满剩余高度 */
export const AppLayout = defineComponent({
  name: 'AppLayout',
  setup() {
    return () => (
      <div class={styles.root}>
        <AppHeader />
        <main class={styles.main}>
          <RouterView />
        </main>
      </div>
    );
  }
});
