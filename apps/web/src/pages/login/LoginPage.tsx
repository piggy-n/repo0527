import { ElButton, ElEmpty } from 'element-plus';
import { defineComponent } from 'vue';
import { useRouter } from 'vue-router';
import { RouteName } from '@/shared/router/route-names';
import styles from './LoginPage.module.scss';

/** 登录页占位：登录表单与鉴权按设计稿确认后实现 */
export const LoginPage = defineComponent({
  name: 'LoginPage',
  setup() {
    const router = useRouter();

    const enter = () => {
      void router.push({ name: RouteName.home });
    };

    return () => (
      <div class={styles.root}>
        <ElEmpty description="登录页：待实现">
          <ElButton
            type="primary"
            onClick={enter}
          >
            进入系统
          </ElButton>
        </ElEmpty>
      </div>
    );
  }
});
