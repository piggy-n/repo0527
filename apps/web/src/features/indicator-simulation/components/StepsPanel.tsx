import { MxPanel } from '@yzt/ui';
import { defineComponent, type PropType, type SlotsType, type VNode } from 'vue';
import { type IconName, SvgIcon } from '@/shared/icons/SvgIcon';
import type { EngineState } from '../engine/engine';
import { STEP_GROUPS, type StepGroupId, type StepId } from '../engine/steps';
import type { StepRecord } from '../run/narrative';
import {
  doneCount,
  groupStatus,
  groupText,
  isRestartGroup,
  nextGroup,
  STATUS_LABELS,
  stepGroup,
  stepText,
  visibleGroups
} from '../run/run-view';
import styles from './StepsPanel.module.scss';

export const GROUP_ICONS: Readonly<Record<StepGroupId, IconName>> = {
  parse: 'simulation-parse',
  prep: 'simulation-data',
  qc: 'simulation-qc',
  spatial: 'simulation-spatial',
  compute: 'simulation-compute',
  evaluate: 'dashboard-bar',
  report: 'menu-report'
};

const SHORT_NAMES: Readonly<Partial<Record<StepId, string>>> = { pop: '人口', poi: '设施', land: '用地' };

/** 左侧的推演步骤：开始了才出现，下一步只露出虚影；数据准备的三路并行显示为子项；点一行在右上回看这一步 */
export const StepsPanel = defineComponent({
  name: 'StepsPanel',
  props: {
    state: { type: Object as PropType<EngineState>, required: true },
    progress: { type: Function as PropType<(step: StepId) => number>, required: true },
    /** 一行的记录（取完成后的摘要）；还没有计算器时为 null */
    recordOf: { type: Function as PropType<(group: StepGroupId) => StepRecord | null>, required: true },
    /** 右上正在显示的一行 */
    selected: { type: String as PropType<StepGroupId | null>, default: null },
    title: { type: String, default: 'AI 推演' },
    /** 结果阶段的推演概览：每行只留名称和标记 */
    compact: Boolean
  },
  slots: Object as SlotsType<{
    /** 步骤列表前面：推演概览的条件 */
    before?: () => VNode[];
    /** 步骤列表后面：推演概览的版本 */
    after?: () => VNode[];
  }>,
  emits: {
    select: (group: StepGroupId) => typeof group === 'string',
    collapse: () => true
  },
  setup(props, { emit, slots }) {
    const bar = (step: StepId) => (
      <i class={styles.bar}>
        <b style={{ transform: `scaleX(${props.progress(step)})` }} />
      </i>
    );

    const renderRow = (id: StepGroupId, index: number) => {
      const { state } = props;
      const group = stepGroup(id);
      const status = groupStatus(id, state.steps);
      const changed = status === 'stale' && isRestartGroup(id, state);
      const human = group.steps.some(step => state.steps[step].human);
      const summaries = status === 'waiting' ? {} : (props.recordOf(id)?.summaries ?? {});
      const label = state.paused && status === 'running' ? '已暂停' : changed ? '已调整' : STATUS_LABELS[status];
      return (
        <li key={id} class={[styles.step, styles[status], changed && styles.changed]}>
          <span class={styles.dot}>
            {index > 0 && <span class={styles.spark} />}
            <span class={styles.ring} />
            <SvgIcon name={GROUP_ICONS[id]} />
          </span>
          <button
            type="button"
            class={styles.main}
            aria-pressed={props.selected === id}
            onClick={() => emit('select', id)}
          >
            <span class={styles.head}>
              <b>{group.name}</b>
              {label !== '' && <span class={styles.badge}>{label}</span>}
              {human && <span class={styles.human}>人工</span>}
            </span>
            <span class={styles.sub}>{groupText(id, state, summaries)}</span>
            {group.steps.length > 1 ? (
              <span class={styles.substeps}>
                {group.steps.map(step => (
                  <span key={step} class={[styles.substep, styles[state.steps[step].status]]}>
                    <span class={styles.subName}>{SHORT_NAMES[step]}</span>
                    <span class={styles.subValue}>{stepText(step, state, summaries[step])}</span>
                    {bar(step)}
                  </span>
                ))}
              </span>
            ) : (
              group.steps.map(step => <span key={step}>{bar(step)}</span>)
            )}
          </button>
        </li>
      );
    };

    return () => {
      const { state } = props;
      const visible = visibleGroups(state);
      const next = nextGroup(state);
      return (
        <MxPanel class={styles.panel} title={props.title} headerTone="muted" floating>
          {{
            icon: () => <SvgIcon name="simulation-ai" />,
            actions: () => [
              <span key="count" class={styles.count}>
                {doneCount(state)}/{STEP_GROUPS.length}
              </span>,
              <button
                key="collapse"
                type="button"
                class={styles.collapse}
                aria-label="收起推演步骤"
                onClick={() => emit('collapse')}
              >
                <SvgIcon name="panel-collapse" />
              </button>
            ],
            default: () => (
              <div class={[styles.body, props.compact && styles.compact]}>
                {slots.before?.()}
                {state.status === 'planning' && (
                  <div key="planning" class={styles.planning}>
                    <span class={styles.orb} />
                    正在理解推演条件，规划推演步骤…
                  </div>
                )}
                {state.status === 'failed' && (
                  <p key="failed" class={styles.failed}>
                    推演出错：{state.error instanceof Error ? state.error.message : String(state.error)}
                  </p>
                )}
                <ol class={styles.list}>
                  {visible.map(renderRow)}
                  {next !== null && (
                    <li key="ghost" class={[styles.step, styles.ghost]}>
                      <span class={styles.dot}>
                        <SvgIcon name={GROUP_ICONS[next]} />
                      </span>
                      <span class={styles.main}>
                        <span class={styles.head}>
                          <b>下一步 · {stepGroup(next).name}</b>
                        </span>
                      </span>
                    </li>
                  )}
                </ol>
                {slots.after?.()}
              </div>
            )
          }}
        </MxPanel>
      );
    };
  }
});
