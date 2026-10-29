import { defineComponent } from 'vue';
import { RouterLink } from 'vue-router';
import { RouteName } from '@/shared/router/route-names';
import { IndicatorSimulationPage } from '../../indicator-simulation/IndicatorSimulationPage';
import styles from './DevIndicatorSimulationPage.module.scss';

/** 指标智能推演的组件样例：真实页面，不登录；数据本来就是本地的模拟值 */
export const DevIndicatorSimulationPage = defineComponent({
  name: 'DevIndicatorSimulationPage',
  setup() {
    return () => (
      <div class={styles.root}>
        <div class={styles.bar}>
          <strong>指标智能推演样例</strong>
          <span>真实页面，模拟数据，不请求后端</span>
          <RouterLink class={styles.link} to={{ name: RouteName.devTheme }}>
            主题预览
          </RouterLink>
        </div>
        <div class={styles.stage}>
          <IndicatorSimulationPage />
        </div>
      </div>
    );
  }
});
