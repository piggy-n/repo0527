import { Loading } from '@element-plus/icons-vue';
import { ElButton, ElIcon } from 'element-plus';
import { type MapViewSwitchState, useMap } from '@yzt/map-vue';
import { computed, defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '../composables/useDelayedFlag';
import { SvgIcon } from '../icons/SvgIcon';
import { describeMapStatus } from './map-status';
import styles from './MapStatusNotice.module.scss';

/**
 * 地图的加载与失败提示（ADR 0030，设计稿 5D.7）：放在地图区域里，父元素要能作为定位参照。
 * 显示什么由 describeMapStatus 决定，这里只负责显示；加载中延迟出现，很快加载完就不显示
 */
export const MapStatusNotice = defineComponent({
  name: 'MapStatusNotice',
  props: {
    /** 候选加载反馈，重试交给页面持有的切换拥有者 */
    viewSwitch: { type: Object as PropType<MapViewSwitchState>, default: undefined }
  },
  emits: { retrySwitch: () => true },
  setup(props, { emit }) {
    const map = useMap();
    const status = computed(() => describeMapStatus(map.viewState.value, map.failure.value, props.viewSwitch));
    const loadingShown = useDelayedFlag(() => status.value.kind === 'loading');
    const retry = () => {
      if (props.viewSwitch?.status === 'failed') {
        emit('retrySwitch');
      } else {
        map.retry();
      }
    };

    return () => {
      const current = status.value;
      if (current.kind === 'engine-failed') {
        return (
          <div class={styles.card} role="alert" data-map-status="engine-failed">
            <SvgIcon class={styles.icon} name="warning" size={32} />
            <strong class={styles.title}>{current.title}</strong>
            <p class={styles.detail}>{current.detail}</p>
            {current.technical && <p class={styles.technical}>{current.technical}</p>}
            <ElButton type="primary" onClick={retry}>
              重试
            </ElButton>
          </div>
        );
      }
      if (current.kind === 'style-failed' || current.kind === 'switch-failed') {
        return (
          <div class={styles.bar} role="alert" data-map-status={current.kind}>
            <SvgIcon class={styles.barIcon} name="warning" size={16} />
            <div class={styles.barText}>
              <strong class={styles.barTitle}>{current.title}</strong>
              <p class={styles.detail}>{current.detail}</p>
              <p class={styles.technical}>{current.technical}</p>
            </div>
            {current.kind === 'switch-failed' && <ElButton onClick={retry}>重试</ElButton>}
          </div>
        );
      }
      if (current.kind === 'loading' && loadingShown.value) {
        return (
          <div class={styles.loading} data-map-status="loading">
            <ElIcon class={['is-loading', styles.spinner]}>
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
