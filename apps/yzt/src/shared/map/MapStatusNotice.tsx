import { Loading } from '@element-plus/icons-vue';
import { ElButton, ElIcon } from 'element-plus';
import { useMap } from '@mx/map-vue';
import { computed, defineComponent, inject } from 'vue';
import { useDelayedFlag } from '../composables/useDelayedFlag';
import { SvgIcon } from '../icons/SvgIcon';
import { describeMapStatus } from './map-status';
import styles from './MapStatusNotice.module.scss';
import { SCENE_TIER_NOTICE, type SceneTierNotice } from './scene-tier/scene-tier';

// 崩溃后降档的说明（ADR 0155 第 4 节）：恢复过的页面又崩时不能再恢复
function tierDetail({ restorable, restoredBefore }: SceneTierNotice): string {
  if (!restorable) {
    return '恢复后又崩溃过。如需恢复，请联系管理员调整配置。';
  }
  return restoredBefore ? '上次打开三维时页面崩溃了，恢复后又崩溃过。' : '上次打开三维时页面崩溃了。';
}

/**
 * 地图的加载与失败提示（ADR 0030，设计稿 5D.7）：放在地图区域里，父元素要能作为定位参照。
 * 显示什么由 describeMapStatus 决定，这里只负责显示；加载中延迟出现，很快加载完就不显示。
 * 三维因为上次崩溃降了档时，三维里在上方提示一次，可以恢复（ADR 0155）；没有 app 提供的提示时不显示
 */
export const MapStatusNotice = defineComponent({
  name: 'MapStatusNotice',
  setup() {
    const map = useMap();
    const sceneTier = inject(SCENE_TIER_NOTICE, null);
    const status = computed(() => describeMapStatus(map.viewState.value, map.failure.value));
    const loadingShown = useDelayedFlag(() => status.value.kind === 'loading');

    return () => {
      const current = status.value;
      if (current.kind === 'engine-failed') {
        return (
          <div class={styles.card} role="alert" data-map-status="engine-failed">
            <SvgIcon class={styles.icon} name="warning" size={32} />
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
          <div class={styles.bar} role="alert" data-map-status="style-failed">
            <SvgIcon class={styles.barIcon} name="warning" size={16} />
            <div class={styles.barText}>
              <strong class={styles.barTitle}>{current.title}</strong>
              <p class={styles.detail}>{current.detail}</p>
              <p class={styles.technical}>{current.technical}</p>
            </div>
          </div>
        );
      }
      const tierNotice = map.dimension.value === '3d' ? sceneTier?.notice.value : null;
      return [
        tierNotice && sceneTier && (
          <div key="scene-tier" class={styles.bar} role="status" data-map-status="scene-tier">
            <SvgIcon class={styles.barIcon} name="warning" size={16} />
            <div class={styles.barText}>
              <strong class={styles.barTitle}>三维画质已调低</strong>
              <p class={styles.detail}>{tierDetail(tierNotice)}</p>
            </div>
            <div class={styles.barActions}>
              {tierNotice.restorable && (
                <ElButton size="small" type="primary" onClick={() => sceneTier.restore()}>
                  恢复原来的画质
                </ElButton>
              )}
              <ElButton size="small" onClick={() => sceneTier.dismissNotice()}>
                知道了
              </ElButton>
            </div>
          </div>
        ),
        current.kind === 'loading' && loadingShown.value && (
          <div key="loading" class={styles.loading} data-map-status="loading">
            <ElIcon class={['is-loading', styles.spinner]}>
              <Loading />
            </ElIcon>
            地图加载中…
          </div>
        )
      ];
    };
  }
});
