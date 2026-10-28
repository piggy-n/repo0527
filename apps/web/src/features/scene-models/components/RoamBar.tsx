import { Close, RefreshLeft, VideoPause, VideoPlay } from '@element-plus/icons-vue';
import {
  DEFAULT_WALK_SPEED,
  ROUTE_SPEED,
  type WalkNotice,
  WALK_SPEEDS,
  type WalkView,
  WALK_VIEWS
} from '@yzt/map-core';
import { ElButton, ElProgress, ElRadioButton, ElRadioGroup, ElTooltip } from 'element-plus';
import { computed, defineComponent, onScopeDispose, type PropType, ref, watch } from 'vue';
import { MAP_TOOLTIP_PROPS } from '@/shared/map/tooltip';
import type { SceneModel } from '../catalog';
import type { RoutePhase, SceneModels, WalkStage } from '../composables/useSceneModels';
import { ROUTE_RATES, type WalkChoice } from '../scene-content';
import styles from './RoamBar.module.scss';

const PLAY_LABELS: Readonly<Record<Exclude<RoutePhase, 'playing'>, string>> = {
  ready: '开始',
  paused: '继续',
  finished: '重新开始'
};

const NOTICE_TEXT: Readonly<Record<WalkNotice, string>> = {
  'not-standable': '请点击可以站立的地面',
  hidden: '目标位置被遮挡，请点击看得见的地面',
  blocked: '前方受阻，已停下',
  open: '当前位置可以正常行走，无需脱困',
  'no-open-ground': '附近没有开阔的地面，可以回到起始点',
  'avatar-failed': '人物模型加载失败，第三人称看不到人'
};

const VIEW_LABELS: Readonly<Record<WalkView, string>> = { first: '第一人称', third: '第三人称' };

// 操作说明按人称：第一人称滚轮改视野，第三人称滚轮、中键拖动调相机远近
const WALK_HINTS: Readonly<Record<WalkView, string>> = {
  first: '左键点击地面移动 · 右键拖动转向 · 滚轮缩放视野 · W/A/S/D 行走 · Esc 退出',
  third: '左键点击地面移动 · 右键拖动旋转视角 · 滚轮 / 中键拖动调远近 · W/A/S/D 行走 · Esc 退出'
};

const FAILED_TEXT: Readonly<Record<Extract<WalkStage, { kind: 'failed' }>['reason'], string>> = {
  build: '站内空间分析失败，请重试',
  spawn: '附近没有找到可以站立的室内位置'
};

// 提示显示这么久后消失（毫秒）
const NOTICE_DURATION = 3500;

function formatLength(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * 漫游的操作条（ADR 0083 第 4 节、ADR 0086 第 5 节，原型 `/dev/map-3d`）：漫游时在地图下方居中；不在漫游时不渲染。
 * 人称切换在速度那一行最前面，由页面决定显示（ADR 0090：第三人称暂不开放，页面上不显示）
 */
export const RoamBar = defineComponent({
  name: 'RoamBar',
  props: {
    models: { type: Object as PropType<SceneModels>, required: true },
    /** 显示人称切换 */
    personSwitch: { type: Boolean, default: false }
  },
  setup(props) {
    // 正在漫游的模型；目录里没有了（清单刷新）时不显示
    const model = computed(() => {
      const roam = props.models.roam.value;
      return roam ? props.models.models.value.find(item => item.id === roam.modelId) : undefined;
    });

    // 提示来了就显示，几秒后消失；同样的提示再来一次（计数变了）重新计时
    const notice = ref<WalkNotice | null>(null);
    let noticeTimer: ReturnType<typeof setTimeout> | undefined;
    watch(
      () => props.models.walkNotice.value?.count ?? 0,
      () => {
        clearTimeout(noticeTimer);
        const current = props.models.walkNotice.value;
        notice.value = current?.notice ?? null;
        if (current) {
          noticeTimer = setTimeout(() => (notice.value = null), NOTICE_DURATION);
        }
      }
    );
    onScopeDispose(() => clearTimeout(noticeTimer));

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

    const renderRoute = (current: SceneModel, routeId: string, rate: number, phase: RoutePhase) => {
      const route = current.routes.find(item => item.id === routeId);
      if (!route) {
        return null;
      }
      const total = route.length;
      const walked = Math.min(
        props.models.roamStatus.value?.kind === 'route' ? props.models.roamStatus.value.distance : 0,
        total
      );
      const remaining = (total - walked) / (ROUTE_SPEED * rate);
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
              <span class={styles.subtitle}>{current.name}</span>
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
              modelValue={rate}
              onUpdate:modelValue={value => props.models.setRouteRate(Number(value))}
            >
              {ROUTE_RATES.map(item => (
                <ElRadioButton key={item} value={item}>
                  {item}×
                </ElRadioButton>
              ))}
            </ElRadioGroup>
          </div>
          <p class={styles.hint}>{hint}</p>
        </div>
      );
    };

    // 速度按档位加减，到头时按钮不可用
    const renderSpeed = (speed: number) => {
      const { models } = props;
      const index = WALK_SPEEDS.indexOf(speed);
      const step = (offset: number) => {
        const next = WALK_SPEEDS[index + offset];
        if (next !== undefined) {
          models.setWalkSpeed(next);
        }
      };
      return (
        <span class={styles.speed}>
          速度
          <ElButton size="small" aria-label="减速" disabled={index <= 0} onClick={() => step(-1)}>
            −
          </ElButton>
          <b>{speed} m/s</b>
          <ElButton size="small" aria-label="加速" disabled={index >= WALK_SPEEDS.length - 1} onClick={() => step(1)}>
            +
          </ElButton>
          <ElButton
            link
            type="primary"
            size="small"
            disabled={speed === DEFAULT_WALK_SPEED}
            onClick={() => models.setWalkSpeed(DEFAULT_WALK_SPEED)}
          >
            默认
          </ElButton>
        </span>
      );
    };

    const renderView = (view: WalkView) => [
      <ElRadioGroup
        size="small"
        aria-label="人称"
        modelValue={view}
        onUpdate:modelValue={value => {
          const next = WALK_VIEWS.find(item => item === value);
          if (next) {
            props.models.setWalkView(next);
          }
        }}
      >
        {WALK_VIEWS.map(item => (
          <ElRadioButton key={item} value={item}>
            {VIEW_LABELS[item]}
          </ElRadioButton>
        ))}
      </ElRadioGroup>,
      <span class={styles.divider} />
    ];

    const renderWalkBody = (stage: WalkStage, walk: WalkChoice) => {
      const { models } = props;
      if (stage.kind === 'preparing' || stage.kind === 'entering') {
        const progress = stage.kind === 'preparing' ? Math.round(stage.progress * 100) : 100;
        return (
          <div class={styles.preparing} role="status">
            <span>{stage.kind === 'preparing' ? `正在分析站内空间 ${progress}%` : '正在进入站内…'}</span>
            <ElProgress class={styles.progress} percentage={progress} showText={false} />
          </div>
        );
      }
      if (stage.kind === 'failed') {
        return (
          <div class={styles.controls}>
            <span class={styles.error} role="alert">
              {FAILED_TEXT[stage.reason]}
            </span>
            {stage.reason === 'build' && (
              <ElButton link type="primary" size="small" onClick={models.retryWalk}>
                重试
              </ElButton>
            )}
          </div>
        );
      }
      return (
        <>
          <div class={styles.controls}>
            {props.personSwitch && renderView(walk.view)}
            {renderSpeed(walk.speed)}
            <span class={styles.divider} />
            <ElButton link type="primary" size="small" onClick={models.respawnWalk}>
              回到起始点
            </ElButton>
            <ElTooltip {...MAP_TOOLTIP_PROPS} content="被卡住时挪到附近最近的开阔地面" placement="top">
              <ElButton link type="primary" size="small" onClick={models.unstuckWalk}>
                脱困
              </ElButton>
            </ElTooltip>
          </div>
          <p class={styles.hint}>{WALK_HINTS[walk.view]}</p>
          {notice.value && (
            <p class={styles.message} role="status">
              {NOTICE_TEXT[notice.value]}
            </p>
          )}
        </>
      );
    };

    const renderWalk = (current: SceneModel, walk: WalkChoice, stage: WalkStage) => {
      // 还没进到站内时只能取消；进去以后、失败时是退出
      const pending = stage.kind === 'preparing' || stage.kind === 'entering';
      return (
        <div class={styles.bar} role="region" aria-label="步行漫游" data-roam-bar>
          <div class={styles.head}>
            <strong class={styles.title}>步行漫游 · {current.name}</strong>
            {pending ? (
              <ElButton size="small" onClick={props.models.exitRoam}>
                取消
              </ElButton>
            ) : (
              <ElButton size="small" type="primary" plain icon={Close} onClick={props.models.exitRoam}>
                退出漫游
              </ElButton>
            )}
          </div>
          {renderWalkBody(stage, walk)}
        </div>
      );
    };

    return () => {
      const roam = props.models.roam.value;
      const current = model.value;
      if (!roam || !current) {
        return null;
      }
      if (roam.kind === 'walk') {
        const stage = props.models.walkStage.value;
        return stage ? renderWalk(current, roam, stage) : null;
      }
      const phase = props.models.routePhase.value;
      return phase ? renderRoute(current, roam.routeId, roam.rate, phase) : null;
    };
  }
});
