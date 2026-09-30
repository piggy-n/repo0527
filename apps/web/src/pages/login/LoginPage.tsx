import { ElMessage } from 'element-plus';
import { defineComponent } from 'vue';
import { useRouter } from 'vue-router';
import { LoginForm } from '@/features/auth/components/LoginForm';
import { roleHome } from '@/shared/auth/roles';
import type { Session } from '@/shared/auth/session-store';
import { SystemTitle } from '@/shared/system-title/SystemTitle';
import { WelcomeText } from '@/shared/system-title/WelcomeText';
import styles from './LoginPage.module.scss';

/** 登录页：左侧插画、右侧登录卡片，窄屏只显示卡片与底图；布局与断点见 docs/modules/auth.md */
export const LoginPage = defineComponent({
  name: 'LoginPage',
  setup() {
    const router = useRouter();

    // replace：登录后按后退键不会回到登录页
    const enterHome = async (session: Session) => {
      await router.replace({ name: roleHome(session.user.role) });
      ElMessage.success('登录成功');
    };

    return () => (
      <div class={styles.root}>
        <div class={styles.illustration} />
        <main class={styles.formArea}>
          <div class={styles.card}>
            <header class={styles.header}>
              <h1 class={styles.title}>
                <SystemTitle />
              </h1>
              <div class={styles.welcome}>
                <WelcomeText />
              </div>
            </header>
            <LoginForm onSuccess={enterHome} />
          </div>
        </main>
      </div>
    );
  }
});
