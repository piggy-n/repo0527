import { Close, RefreshLeft, VideoPause, VideoPlay } from '@element-plus/icons-vue';
import { ROUTE_SPEED } from '@yzt/map-core';
import { ElButton, ElProgress, ElRadioButton, ElRadioGroup } from 'element-plus';
import { computed, defineComponent, type PropType } from 'vue';
import type { RoutePhase, SceneModels } from '../composables/useSceneModels';
import { ROUTE_RATES } from '../scene-content';
import styles from './RoamBar.module.scss';

const PLAY_LABELS: Readonly<Record<Exclude<RoutePhase, 'playing'>, string>> = {
  ready: '开始',
  paused: '继续',
  finished: '重新开始'
};

function formatLength(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** 路线漫游的操作条（ADR 0083 第 4 节，原型 `/dev/map-3d`）：漫游时在地图下方居中；不在漫游时不渲染 */
export const RoamBar = defineComponent({
  name: 'RoamBar',
  props: {
    models: { type: Object as PropType<SceneModels>, required: true }
  },
  setup(props) {
    // 正在漫游的模型和路线；目录里没有了（清单刷新）时不显示
    const target = computed(() => {
      const roam = props.models.roam.value;
      const model = roam && props.models.models.value.find(item => item.id === roam.modelId);
      const route = roam && model?.routes.find(item => item.id === roam.routeId);
      return roam && model && route ? { roam, model, route } : null;
    });

    const renderPlayback = (phase: RoutePhase) => {
      const { models } = props;
      if (phase === 'playing') {
        return (
          <ElButton size="small" type="primary" icon={VideoPause} onClick={models.pauseRoute}>
            暂停
          </ElButton>
        );
      }
      return (
        <ElButton
          size="small"
          type="primary"
          icon={phase === 'finished' ? RefreshLeft : VideoPlay}
          onClick={models.playRoute}
        >
          {PLAY_LABELS[phase]}
        </ElButton>
      );
    };

    return () => {
      const current = target.value;
      const phase = props.models.routePhase.value;
      if (!current || !phase) {
        return null;
      }
      const { roam, model, route } = current;
      const total = route.length;
      const walked = Math.min(props.models.roamStatus.value?.distance ?? 0, total);
      const remaining = (total - walked) / (ROUTE_SPEED * roam.rate);
      const distance =
        phase === 'finished'
          ? '已到终点'
          : `${formatLength(walked)} / ${formatLength(total)} · 剩余 ${formatTime(remaining)}`;
      const hint = phase === 'paused' ? '暂停时可拖动查看四周，继续后回到路线视角' : '空格暂停或继续 · Esc 退出';
      return (
        <div class={styles.bar} role="region" aria-label="路线漫游" data-roam-bar>
          <div class={styles.head}>
            <strong class={styles.title}>
              路线漫游 · {route.name}
              <span class={styles.subtitle}>{model.name}</span>
            </strong>
            <ElButton size="small" type="primary" plain icon={Close} onClick={props.models.exitRoam}>
              退出漫游
            </ElButton>
          </div>
          <div class={styles.controls}>
            {renderPlayback(phase)}
            <ElProgress
              class={styles.progress}
              percentage={total > 0 ? Math.round((walked / total) * 100) : 0}
              showText={false}
            />
            <span class={styles.distance} role="status">
              {distance}
            </span>
            <ElRadioGroup
              size="small"
              aria-label="漫游速度"
              modelValue={roam.rate}
              onUpdate:modelValue={value => props.models.setRouteRate(Number(value))}
            >
              {ROUTE_RATES.map(rate => (
                <ElRadioButton key={rate} value={rate}>
                  {rate}×
                </ElRadioButton>
              ))}
            </ElRadioGroup>
          </div>
          <p class={styles.hint}>{hint}</p>
        </div>
      );
    };
  }
});
