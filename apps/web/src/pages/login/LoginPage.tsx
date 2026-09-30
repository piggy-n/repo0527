import { ElMessage } from 'element-plus';
import { defineComponent } from 'vue';
import { useRouter } from 'vue-router';
import { LoginForm } from '@/features/auth/components/LoginForm';
import { roleHome } from '@/shared/auth/roles';
import type { Session } from '@/shared/auth/session-store';
import { SystemTitle } from '@/shared/system-title/SystemTitle';
import styles from './LoginPage.module.scss';

/** 登录页：暂用简单的卡片布局，背景图到位后按设计稿（方案 A）完成外观 */
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
        <div class={styles.card}>
          <h1 class={styles.title}>
            <SystemTitle />
          </h1>
          <LoginForm onSuccess={enterHome} />
        </div>
      </div>
    );
  }
});
