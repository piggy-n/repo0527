import { ElButton, ElResult } from 'element-plus';
import { defineComponent } from 'vue';
import { useRouter } from 'vue-router';
import { RouteName } from '@/shared/router/route-names';
import styles from './NotFoundPage.module.scss';

export const NotFoundPage = defineComponent({
  name: 'NotFoundPage',
  setup() {
    const router = useRouter();

    const goHome = () => {
      void router.push({ name: RouteName.home });
    };

    return () => (
      <div class={styles.root}>
        <ElResult
          icon="warning"
          title="404"
          subTitle="页面不存在"
        >
          {{
            extra: () => (
              <ElButton
                type="primary"
                onClick={goHome}
              >
                返回首页
              </ElButton>
            )
          }}
        </ElResult>
      </div>
    );
  }
});
