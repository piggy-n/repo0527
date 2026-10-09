import { Loading, WarningFilled } from '@element-plus/icons-vue';
import { ElAlert, ElButton, ElIcon } from 'element-plus';
import { useMap } from '@yzt/map-vue';
import { computed, defineComponent } from 'vue';
import { useDelayedFlag } from '../composables/useDelayedFlag';
import { describeMapStatus } from './map-status';
import styles from './MapStatusNotice.module.scss';

/**
 * 地图的加载与失败提示（联调用的界面，5D 再设计）：放在地图区域里，父元素要能作为定位参照。
 * 显示什么由 describeMapStatus 决定，这里只负责显示；加载中延迟出现，很快加载完就不显示
 */
export const MapStatusNotice = defineComponent({
  name: 'MapStatusNotice',
  setup() {
    const map = useMap();
    const status = computed(() => describeMapStatus(map.viewState.value, map.failure.value));
    const loadingShown = useDelayedFlag(() => status.value.kind === 'loading');

    return () => {
      const current = status.value;
      if (current.kind === 'engine-failed') {
        return (
          <div class={styles.card} role="alert">
            <ElIcon class={styles.icon}>
              <WarningFilled />
            </ElIcon>
            <strong class={styles.title}>{current.title}</strong>
            <p class={styles.detail}>{current.detail}</p>
            {current.technical && <p class={styles.technical}>{current.technical}</p>}
            <ElButton type="primary" onClick={() => map.retry()}>
              重试
            </ElButton>
          </div>
        );
      }
      if (current.kind === 'style-failed') {
        return (
          <ElAlert class={styles.alert} type="warning" showIcon closable={false} title={current.title}>
            <p class={styles.detail}>{current.detail}</p>
            <p class={styles.technical}>{current.technical}</p>
          </ElAlert>
        );
      }
      if (current.kind === 'loading' && loadingShown.value) {
        return (
          <div class={styles.loading}>
            <ElIcon class="is-loading">
              <Loading />
            </ElIcon>
            地图加载中…
          </div>
        );
      }
      return null;
    };
  }
});
