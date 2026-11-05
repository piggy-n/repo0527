import { Close, RefreshLeft, VideoPause, VideoPlay } from '@element-plus/icons-vue';
import { MxPanel } from '@yzt/ui';
import { ElButton, ElProgress, ElRadioButton, ElRadioGroup, ElTooltip } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { MAP_TOOLTIP_PROPS } from '@/shared/map/tooltip';
import { MODEL_KIND_LABELS, type ModelEntry, type ModelRoute } from './model-samples';
import {
  DEFAULT_ROAM_SPEED,
  type ModelDemo,
  ROAM_SPEEDS,
  type RoamMode,
  type RoutePhase,
  type WalkPhase
} from './useModelDemo';
import styles from './RoamPanel.module.scss';

const MODES: readonly { value: RoamMode; label: string }[] = [
  { value: 'walk', label: '步行' },
  { value: 'route', label: '路线' }
];

const PLAY_LABELS: Readonly<Record<Exclude<RoutePhase, 'playing'>, string>> = {
  ready: '开始',
  paused: '继续',
  finished: '重新开始'
};

// 操作说明：按键在左、作用在右
const WALK_HINTS: readonly (readonly [string, string])[] = [
  ['左键点击地面', '走过去'],
  ['右键拖动', '转向'],
  ['滚轮', '缩放视野'],
  ['W / A / S / D', '行走'],
  ['Esc', '退出漫游']
];

const ROUTE_HINTS: readonly (readonly [string, string])[] = [
  ['空格', '开始、暂停或继续'],
  ['暂停时拖动', '查看四周，继续后回到路线视角'],
  ['Esc', '退出漫游']
];

function formatLength(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// 操作说明列成两列：按键、作用
const renderHints = (hints: readonly (readonly [string, string])[]) => (
  <dl class={styles.hints}>
    {hints.map(([key, action]) => [<dt key={`${key}-key`}>{key}</dt>, <dd key={`${key}-action`}>{action}</dd>])}
  </dl>
);

/**
 * 原型（2026-10-28）：漫游时替换左侧的三维模型面板，退出后换回来。一次漫游一个模型，步行和路线是它的两种方式，
 * 在面板里切换；预置路线在面板里选，速度两种方式共用（米/秒，默认 4）；没有单独的钻地
 */
export const RoamPanel = defineComponent({
  name: 'RoamPanel',
  props: {
    owner: { type: Object as PropType<ModelDemo>, required: true },
    collapsed: { type: Boolean, default: false }
  },
  emits: {
    'update:collapsed': (collapsed: boolean) => typeof collapsed === 'boolean'
  },
  setup(props, { emit }) {
    const renderSpeed = () => {
      const { owner } = props;
      const speed = owner.speed.value;
      const index = ROAM_SPEEDS.findIndex(item => item === speed);
      return (
        <div class={styles.row}>
          <span class={styles.label}>速度</span>
          <ElButton size="small" aria-label="减速" disabled={index <= 0} onClick={() => owner.changeSpeed(-1)}>
            −
          </ElButton>
          <b class={styles.speed}>{speed} m/s</b>
          <ElButton
            size="small"
            aria-label="加速"
            disabled={index >= ROAM_SPEEDS.length - 1}
            onClick={() => owner.changeSpeed(1)}
          >
            +
          </ElButton>
          <ElButton link type="primary" size="small" disabled={speed === DEFAULT_ROAM_SPEED} onClick={owner.resetSpeed}>
            默认
          </ElButton>
        </div>
      );
    };

    const renderWalk = (phase: WalkPhase, progress: number) => {
      const { owner } = props;
      if (phase !== 'walking') {
        const percent = Math.round(progress * 100);
        return (
          <div class={styles.section} role="status">
            <span class={styles.muted}>{phase === 'preparing' ? `正在分析站内空间 ${percent}%` : '正在进入站内…'}</span>
            <ElProgress percentage={phase === 'preparing' ? percent : 100} showText={false} />
          </div>
        );
      }
      return (
        <>
          <div class={styles.section}>
            {renderSpeed()}
            <div class={styles.row}>
              <ElButton size="small" onClick={owner.resetSpawn}>
                回到起始点
              </ElButton>
              <ElTooltip {...MAP_TOOLTIP_PROPS} content="被卡住时挪到附近最近的开阔地面" placement="top">
                <ElButton size="small" onClick={owner.unstuck}>
                  脱困
                </ElButton>
              </ElTooltip>
            </div>
            {owner.message.value && (
              <p class={styles.message} role="status">
                {owner.message.value}
              </p>
            )}
          </div>
          {renderHints(WALK_HINTS)}
        </>
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

    const renderRoute = (model: ModelEntry, route: ModelRoute, phase: RoutePhase, progress: number) => {
      const { owner } = props;
      const walked = route.length * progress;
      const remaining = (route.length - walked) / owner.speed.value;
      return (
        <>
          <ul class={styles.routes} role="radiogroup" aria-label="预置路线">
            {model.routes.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  role="radio"
                  class={[styles.route, item.id === route.id && styles.currentRoute]}
                  aria-checked={item.id === route.id}
                  onClick={() => owner.startRoute(model.id, item.id)}
                >
                  <span class={styles.routeName}>{item.name}</span>
                  <span class={styles.muted}>{formatLength(item.length)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div class={styles.section}>
            <div class={styles.row}>
              {renderPlayback(phase)}
              <span class={styles.distance} role="status">
                {phase === 'finished'
                  ? '已到终点'
                  : `${formatLength(walked)} / ${formatLength(route.length)} · 剩余 ${formatTime(remaining)}`}
              </span>
            </div>
            <ElProgress percentage={Math.round(progress * 100)} showText={false} />
            {renderSpeed()}
          </div>
          {renderHints(ROUTE_HINTS)}
        </>
      );
    };

    const renderBody = () => {
      const { owner } = props;
      const roam = owner.roam.value;
      const model = owner.roamingModel.value;
      if (roam.kind === 'idle' || !model) {
        return null;
      }
      const route = owner.routeOf(roam);
      return (
        <div class={styles.body}>
          <ElRadioGroup
            class={styles.modes}
            size="small"
            aria-label="漫游方式"
            modelValue={roam.kind}
            onUpdate:modelValue={value => {
              const mode = MODES.find(item => item.value === value);
              if (mode) {
                owner.setMode(mode.value);
              }
            }}
          >
            {MODES.map(item => (
              <ElRadioButton
                key={item.value}
                value={item.value}
                disabled={item.value === 'walk' ? !model.walkable : model.routes.length === 0}
              >
                {item.label}
              </ElRadioButton>
            ))}
          </ElRadioGroup>
          {roam.kind === 'walk' && renderWalk(roam.phase, roam.progress)}
          {roam.kind === 'route' && route && renderRoute(model, route, roam.phase, roam.progress)}
        </div>
      );
    };

    return () => {
      const model = props.owner.roamingModel.value;
      return (
        <div class={styles.root} data-roam-panel>
          {props.collapsed ? (
            <button
              type="button"
              class={styles.strip}
              aria-label="展开漫游"
              onClick={() => emit('update:collapsed', false)}
            >
              <SvgIcon class={styles.stripIcon} name="panel-expand" size={16} />
              <span class={styles.stripLabel}>漫游</span>
            </button>
          ) : (
            <MxPanel
              floating
              flush
              headerTone="muted"
              class={styles.panel}
              title="漫游"
              description={model ? `${model.name} · ${MODEL_KIND_LABELS[model.kind]}` : undefined}
            >
              {{
                actions: () => (
                  <span class={styles.actions}>
                    <ElButton size="small" type="primary" plain icon={Close} onClick={props.owner.exitRoam}>
                      退出漫游
                    </ElButton>
                    <button
                      type="button"
                      class={styles.collapse}
                      aria-label="收起漫游"
                      onClick={() => emit('update:collapsed', true)}
                    >
                      <SvgIcon name="panel-collapse" size={16} />
                    </button>
                  </span>
                ),
                default: renderBody
              }}
            </MxPanel>
          )}
        </div>
      );
    };
  }
});
