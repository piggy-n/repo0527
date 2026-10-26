import { Close, RefreshLeft, VideoPause, VideoPlay } from '@element-plus/icons-vue';
import { ElButton, ElProgress, ElRadioButton, ElRadioGroup, ElTooltip } from 'element-plus';
import { computed, defineComponent, type PropType, ref } from 'vue';
import { MAP_TOOLTIP_PROPS } from '@/shared/map/tooltip';
import type { ModelRoute } from './model-samples';
import {
  DEFAULT_WALK_SPEED,
  type ModelDemo,
  ROUTE_RATES,
  type RoutePhase,
  WALK_SPEEDS,
  type WalkPhase
} from './useModelDemo';
import styles from './RoamBar.module.scss';

const PREPARE_TEXT: Readonly<Record<WalkPhase, string>> = {
  preparing: '正在分析站内空间',
  entering: '正在进入站内…',
  walking: ''
};

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

// 室内小地图的示意：几块站厅和通道，点是当前位置；展开后双击换位置（示意瞬移）
const PLAN_ROOMS = [
  { x: 10, y: 40, width: 180, height: 46 },
  { x: 60, y: 10, width: 28, height: 32 },
  { x: 130, y: 84, width: 30, height: 40 },
  { x: 20, y: 86, width: 60, height: 22 }
];

/** 原型：漫游时在地图下方居中的操作条；步行漫游和路线漫游各一种布局，第三人称暂不开放 */
export const RoamBar = defineComponent({
  name: 'RoamBar',
  props: {
    owner: { type: Object as PropType<ModelDemo>, required: true },
    /** 手机宽度：小地图缩小 */
    phone: { type: Boolean, default: false }
  },
  setup(props) {
    const mapExpanded = ref(false);
    const position = ref({ x: 70, y: 62 });

    const routeInfo = computed(() => {
      const roam = props.owner.roam.value;
      const route = props.owner.routeOf(roam);
      if (roam.kind !== 'route' || !route) {
        return null;
      }
      return { roam, route, model: props.owner.model(roam.modelId) };
    });

    const moveTo = (event: MouseEvent) => {
      if (event.currentTarget instanceof SVGSVGElement) {
        const box = event.currentTarget.getBoundingClientRect();
        position.value = {
          x: ((event.clientX - box.left) / box.width) * 200,
          y: ((event.clientY - box.top) / box.height) * 140
        };
      }
    };

    const renderPlan = (large: boolean) => (
      <svg
        class={large ? styles.planLarge : styles.plan}
        viewBox="0 0 200 140"
        role="img"
        aria-label={large ? '站内完整地图，双击位置瞬移' : '站内小地图'}
        onDblclick={large ? moveTo : undefined}
      >
        {PLAN_ROOMS.map((room, index) => (
          <rect key={index} class={styles.room} {...room} rx={3} />
        ))}
        <circle class={styles.me} cx={position.value.x} cy={position.value.y} r={large ? 5 : 6} />
      </svg>
    );

    const renderWalk = (modelId: string, phase: WalkPhase, progress: number) => {
      const { owner } = props;
      const model = owner.model(modelId);
      const speed = owner.walkSpeed.value;
      if (phase !== 'walking') {
        return (
          <div class={styles.bar} role="region" aria-label="步行漫游">
            <div class={styles.head}>
              <strong class={styles.title}>步行漫游 · {model.name}</strong>
              <ElButton size="small" onClick={owner.exitRoam}>
                取消
              </ElButton>
            </div>
            <div class={styles.preparing} role="status">
              <span>
                {PREPARE_TEXT[phase]}
                {phase === 'preparing' && ` ${Math.round(progress * 100)}%`}
              </span>
              <ElProgress class={styles.progress} percentage={Math.round(progress * 100)} showText={false} />
            </div>
          </div>
        );
      }
      return (
        <div class={[styles.bar, styles.withPlan]} role="region" aria-label="步行漫游">
          <button
            type="button"
            class={styles.planButton}
            aria-label="展开站内地图"
            aria-expanded={mapExpanded.value}
            onClick={() => (mapExpanded.value = !mapExpanded.value)}
          >
            {renderPlan(false)}
          </button>
          <div class={styles.main}>
            <div class={styles.head}>
              <strong class={styles.title}>步行漫游 · {model.name}</strong>
              <ElButton size="small" type="primary" plain icon={Close} onClick={owner.exitRoam}>
                退出漫游
              </ElButton>
            </div>
            <div class={styles.controls}>
              <span class={styles.speed}>
                速度
                <ElButton
                  size="small"
                  aria-label="减速"
                  disabled={speed <= WALK_SPEEDS[0]}
                  onClick={() => owner.changeWalkSpeed(-1)}
                >
                  −
                </ElButton>
                <b>{speed} m/s</b>
                <ElButton
                  size="small"
                  aria-label="加速"
                  disabled={speed >= WALK_SPEEDS[WALK_SPEEDS.length - 1]}
                  onClick={() => owner.changeWalkSpeed(1)}
                >
                  +
                </ElButton>
                <ElButton
                  link
                  type="primary"
                  size="small"
                  disabled={speed === DEFAULT_WALK_SPEED}
                  onClick={() => (owner.walkSpeed.value = DEFAULT_WALK_SPEED)}
                >
                  默认
                </ElButton>
              </span>
              <span class={styles.divider} />
              <ElButton link type="primary" size="small" onClick={owner.resetSpawn}>
                回到出生点
              </ElButton>
              <ElTooltip {...MAP_TOOLTIP_PROPS} content="被卡住时挪到附近最近的开阔地面" placement="top">
                <ElButton link type="primary" size="small" onClick={owner.unstuck}>
                  脱困
                </ElButton>
              </ElTooltip>
            </div>
            <p class={styles.hint}>左键点击地面移动 · 右键拖动转向 · 滚轮缩放视野 · W/A/S/D 行走 · Esc 退出</p>
            {owner.message.value && (
              <p class={styles.message} role="status">
                {owner.message.value}
              </p>
            )}
          </div>
        </div>
      );
    };

    const renderPlayback = (phase: RoutePhase) => {
      const { owner } = props;
      if (phase === 'playing') {
        return (
          <ElButton size="small" type="primary" icon={VideoPause} onClick={owner.pause}>
            暂停
          </ElButton>
        );
      }
      return (
        <ElButton
          size="small"
          type="primary"
          icon={phase === 'finished' ? RefreshLeft : VideoPlay}
          onClick={owner.play}
        >
          {PLAY_LABELS[phase]}
        </ElButton>
      );
    };

    const renderRoute = (route: ModelRoute, modelName: string, phase: RoutePhase, progress: number) => {
      const { owner } = props;
      const remaining = (route.duration * (1 - progress)) / owner.routeRate.value;
      const walked = `${formatLength(route.length * progress)} / ${formatLength(route.length)}`;
      const distance = phase === 'finished' ? '已到终点' : `${walked} · 剩余 ${formatTime(remaining)}`;
      const hint = phase === 'paused' ? '暂停时可拖动查看四周，继续后回到路线视角' : '空格暂停或继续 · Esc 退出';
      return (
        <div class={styles.bar} role="region" aria-label="路线漫游">
          <div class={styles.head}>
            <strong class={styles.title}>
              路线漫游 · {route.name}
              <span class={styles.subtitle}>{modelName}</span>
            </strong>
            <ElButton size="small" type="primary" plain icon={Close} onClick={owner.exitRoam}>
              退出漫游
            </ElButton>
          </div>
          <div class={styles.controls}>
            {renderPlayback(phase)}
            <ElProgress class={styles.progress} percentage={Math.round(progress * 100)} showText={false} />
            <span class={styles.distance} role="status">
              {distance}
            </span>
            <ElRadioGroup
              size="small"
              aria-label="漫游速度"
              modelValue={owner.routeRate.value}
              onUpdate:modelValue={value => (owner.routeRate.value = Number(value))}
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

    return () => {
      const roam = props.owner.roam.value;
      const info = routeInfo.value;
      if (roam.kind === 'walk') {
        return (
          <div class={[styles.root, props.phone && styles.phone]}>
            {mapExpanded.value && roam.phase === 'walking' && (
              <div class={styles.fullMap} role="dialog" aria-label="站内地图">
                <div class={styles.head}>
                  <strong class={styles.title}>站内地图</strong>
                  <ElButton
                    link
                    size="small"
                    icon={Close}
                    aria-label="收起站内地图"
                    onClick={() => (mapExpanded.value = false)}
                  />
                </div>
                {renderPlan(true)}
                <p class={styles.hint}>双击位置瞬移</p>
              </div>
            )}
            {renderWalk(roam.modelId, roam.phase, roam.progress)}
          </div>
        );
      }
      if (info) {
        const { route, model, roam: state } = info;
        return (
          <div class={[styles.root, props.phone && styles.phone]}>
            {renderRoute(route, model.name, state.phase, state.progress)}
          </div>
        );
      }
      return null;
    };
  }
});
