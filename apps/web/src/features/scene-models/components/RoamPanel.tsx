import { Close, Minus, Plus, RefreshLeft, VideoPause, VideoPlay } from '@element-plus/icons-vue';
import { type WalkNotice, type WalkView, WALK_VIEWS } from '@yzt/map-core';
import { useMapOverlay } from '@yzt/map-vue';
import { MxPanel } from '@yzt/ui';
import { ElButton, ElIcon, ElProgress, ElRadioButton, ElRadioGroup, ElTooltip } from 'element-plus';
import { computed, defineComponent, onScopeDispose, type PropType, ref, watch } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { MAP_TOOLTIP_PROPS } from '@/shared/map/tooltip';
import { MODEL_KIND_LABELS, type SceneModel } from '../catalog';
import type { RoamMode, RoutePhase, SceneModels, WalkStage } from '../composables/useSceneModels';
import { DEFAULT_ROAM_SPEED, ROAM_SPEEDS, type RouteChoice, type WalkChoice } from '../scene-content';
import styles from './RoamPanel.module.scss';

const MODES: readonly { readonly value: RoamMode; readonly label: string }[] = [
  { value: 'walk', label: '步行' },
  { value: 'route', label: '路线' }
];

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

type Hints = readonly (readonly [key: string, action: string])[];

// 操作说明按人称：第一人称滚轮改视野，第三人称滚轮、中键拖动调相机远近
const WALK_HINTS: Readonly<Record<WalkView, Hints>> = {
  first: [
    ['左键点击地面', '移动'],
    ['右键拖动', '转向'],
    ['滚轮', '缩放视野'],
    ['W / A / S / D', '行走'],
    ['Esc', '退出漫游']
  ],
  third: [
    ['左键点击地面', '移动'],
    ['右键拖动', '旋转视角'],
    ['滚轮 / 中键拖动', '调远近'],
    ['W / A / S / D', '行走'],
    ['Esc', '退出漫游']
  ]
};

const ROUTE_HINTS: Hints = [
  ['空格', '开始、暂停或继续'],
  ['暂停时拖动', '查看四周，继续后回到路线视角'],
  ['Esc', '退出漫游']
];

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

// 操作说明列成两列：按键、作用
const renderHints = (hints: Hints) => (
  <dl class={styles.hints}>
    {hints.flatMap(([key, action]) => [<dt key={`${key}-key`}>{key}</dt>, <dd key={`${key}-action`}>{action}</dd>])}
  </dl>
);

/**
 * 漫游面板（ADR 0097，原型 `/dev/map-3d`）：漫游时替换左侧的三维模型面板，退出漫游后页面换回来。一次漫游一个模型，
 * 步行和路线在这里切换，预置路线在这里选，速度两种方式共用（米/秒）。只显示拥有者的状态并调用它的操作；
 * 收起由页面给出；人称切换由页面决定显示（ADR 0090：第三人称暂不开放）。会挡住定位，登记为贴左边的悬浮元素
 */
export const RoamPanel = defineComponent({
  name: 'RoamPanel',
  props: {
    models: { type: Object as PropType<SceneModels>, required: true },
    /** 显示为收起：用户收起了，或窄屏时让给右边 */
    collapsed: { type: Boolean, default: false },
    /** 显示人称切换 */
    personSwitch: { type: Boolean, default: false }
  },
  emits: {
    'update:collapsed': (collapsed: boolean) => typeof collapsed === 'boolean'
  },
  setup(props, { emit }) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'left');

    // 正在漫游的模型；目录里没有了（清单刷新）时不显示内容
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

    const changeMode = (value: unknown) => {
      const mode = MODES.find(item => item.value === value);
      if (mode) {
        props.models.setRoamMode(mode.value);
      }
    };

    // 速度按档位加减，到头时按钮不可用
    const renderSpeed = (speed: number) => {
      const { models } = props;
      const index = ROAM_SPEEDS.indexOf(speed);
      const step = (offset: number) => {
        const next = ROAM_SPEEDS[index + offset];
        if (next !== undefined) {
          models.setSpeed(next);
        }
      };
      return (
        <div class={styles.row}>
          <span class={styles.label}>速度</span>
          <span class={styles.stepper}>
            <button type="button" class={styles.step} aria-label="减速" disabled={index <= 0} onClick={() => step(-1)}>
              <ElIcon>
                <Minus />
              </ElIcon>
            </button>
            <span class={styles.speed}>
              {speed}
              {/* 前面的空格让读出来的文字是"4 m/s"，画面上的间距由 gap 给出 */}
              <small class={styles.unit}> m/s</small>
            </span>
            <button
              type="button"
              class={styles.step}
              aria-label="加速"
              disabled={index >= ROAM_SPEEDS.length - 1}
              onClick={() => step(1)}
            >
              <ElIcon>
                <Plus />
              </ElIcon>
            </button>
          </span>
          <ElButton
            link
            type="primary"
            size="small"
            disabled={speed === DEFAULT_ROAM_SPEED}
            onClick={() => models.setSpeed(DEFAULT_ROAM_SPEED)}
          >
            默认
          </ElButton>
        </div>
      );
    };

    const renderView = (view: WalkView) => (
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
      </ElRadioGroup>
    );

    const renderWalk = (walk: WalkChoice, stage: WalkStage) => {
      const { models } = props;
      if (stage.kind === 'preparing' || stage.kind === 'entering') {
        const progress = stage.kind === 'preparing' ? Math.round(stage.progress * 100) : 100;
        return (
          <div class={styles.section} role="status">
            <span class={styles.muted}>
              {stage.kind === 'preparing' ? `正在分析站内空间 ${progress}%` : '正在进入站内…'}
            </span>
            <ElProgress percentage={progress} showText={false} />
          </div>
        );
      }
      if (stage.kind === 'failed') {
        return (
          <div class={styles.row}>
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
          <div class={styles.section}>
            {props.personSwitch && renderView(walk.view)}
            {renderSpeed(walk.speed)}
            {/* 回到起始点是常用的恢复操作，脱困只在卡住时用，做成次要的文字按钮 */}
            <div class={styles.row}>
              <ElButton size="small" type="primary" plain icon={RefreshLeft} onClick={models.respawnWalk}>
                回到起始点
              </ElButton>
              <ElTooltip {...MAP_TOOLTIP_PROPS} content="被卡住时挪到附近最近的开阔地面" placement="top">
                <ElButton size="small" link onClick={models.unstuckWalk}>
                  脱困
                </ElButton>
              </ElTooltip>
            </div>
            {notice.value && (
              <p class={styles.message} role="status">
                {NOTICE_TEXT[notice.value]}
              </p>
            )}
          </div>
          {renderHints(WALK_HINTS[walk.view])}
        </>
      );
    };

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

    const renderRoute = (current: SceneModel, choice: RouteChoice, phase: RoutePhase) => {
      const { models } = props;
      const route = current.routes.find(item => item.id === choice.routeId);
      if (!route) {
        return null;
      }
      const status = models.roamStatus.value;
      const walked = Math.min(status?.kind === 'route' ? status.distance : 0, route.length);
      const remaining = (route.length - walked) / choice.speed;
      return (
        <>
          <ul class={styles.routes} role="radiogroup" aria-label="预置路线">
            {current.routes.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  role="radio"
                  class={[styles.route, item.id === route.id && styles.currentRoute]}
                  aria-checked={item.id === route.id}
                  data-route={item.id}
                  onClick={() => item.id !== route.id && models.startRoute(current.id, item.id)}
                >
                  <span class={styles.routeName} title={item.name}>
                    {item.name}
                  </span>
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
            <ElProgress
              percentage={route.length > 0 ? Math.round((walked / route.length) * 100) : 0}
              showText={false}
            />
            {renderSpeed(choice.speed)}
          </div>
          {renderHints(ROUTE_HINTS)}
        </>
      );
    };

    const renderBody = (current: SceneModel) => {
      const { models } = props;
      const roam = models.roam.value;
      const stage = models.walkStage.value;
      const phase = models.routePhase.value;
      if (!roam) {
        return null;
      }
      return (
        <div class={styles.body}>
          <ElRadioGroup
            class={styles.modes}
            size="small"
            aria-label="漫游方式"
            modelValue={roam.kind}
            onUpdate:modelValue={changeMode}
          >
            {MODES.map(item => (
              <ElRadioButton
                key={item.value}
                value={item.value}
                disabled={item.value === 'walk' ? !current.spawn : current.routes.length === 0}
              >
                {item.label}
              </ElRadioButton>
            ))}
          </ElRadioGroup>
          {roam.kind === 'walk' && stage && renderWalk(roam, stage)}
          {roam.kind === 'route' && phase && renderRoute(current, roam, phase)}
        </div>
      );
    };

    return () => {
      const current = model.value;
      return (
        <div ref={element} class={styles.root} data-roam-panel>
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
              description={current && `${current.name} · ${MODEL_KIND_LABELS[current.kind]}`}
            >
              {{
                actions: () => (
                  <span class={styles.actions}>
                    <ElButton size="small" type="primary" plain icon={Close} onClick={props.models.exitRoam}>
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
                default: () => current && renderBody(current)
              }}
            </MxPanel>
          )}
        </div>
      );
    };
  }
});
