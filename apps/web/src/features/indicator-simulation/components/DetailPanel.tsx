import { MxPanel } from '@yzt/ui';
import { ElButton } from 'element-plus';
import { computed, defineComponent, nextTick, type PropType, ref, watch } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { EngineState } from '../engine/engine';
import type { StepGroupId, StepId } from '../engine/steps';
import { reducedMotion } from '../motion';
import type { StepRecord } from '../run/narrative';
import { groupStatus, STATUS_LABELS, stepGroup } from '../run/run-view';
import styles from './DetailPanel.module.scss';
import { StepRecordView } from './StepRecordView';
import { GROUP_ICONS } from './StepsPanel';

/** 右上的当前步骤：分析过程、数据、计算依据、参数；推演中跟随当前步骤，点左侧可以回看 */
export const DetailPanel = defineComponent({
  name: 'DetailPanel',
  props: {
    state: { type: Object as PropType<EngineState>, required: true },
    progress: { type: Function as PropType<(step: StepId) => number>, required: true },
    /** 显示哪一行 */
    group: { type: String as PropType<StepGroupId>, required: true },
    record: { type: Object as PropType<StepRecord | null>, default: null },
    /** 在回看别的行（不是当前行）：显示"回到当前" */
    reviewing: Boolean,
    /** 干预后重算的说明 */
    note: { type: String as PropType<string | null>, default: null }
  },
  emits: {
    back: () => true,
    collapse: () => true
  },
  setup(props, { emit }) {
    const body = ref<HTMLElement>();
    const started = (step: StepId) => {
      const { status } = props.state.steps[step];
      return status !== 'waiting' && status !== 'stale';
    };

    // 出现了几句：新的一句出现时滚到底，回看时不动
    const shownLines = computed(() =>
      (props.record?.blocks ?? []).reduce(
        (sum, block) => sum + block.lines.filter(line => props.progress(line.step) >= line.at).length,
        0
      )
    );
    watch(shownLines, async () => {
      if (props.reviewing) {
        return;
      }
      await nextTick();
      if (body.value) {
        body.value.scrollTop = body.value.scrollHeight;
      }
    });

    return () => {
      const { state, group, record } = props;
      const status = groupStatus(group, state.steps);
      const label = state.paused && status === 'running' ? '已暂停' : STATUS_LABELS[status];
      return (
        <MxPanel class={styles.panel} title={stepGroup(group).name} headerTone="muted" floating flush>
          {{
            icon: () => <SvgIcon name={GROUP_ICONS[group]} />,
            actions: () => [
              label !== '' && (
                <span key="status" class={[styles.status, styles[status]]}>
                  {label}
                </span>
              ),
              props.reviewing && (
                <ElButton key="back" link type="primary" onClick={() => emit('back')}>
                  回到当前
                </ElButton>
              ),
              <button
                key="collapse"
                type="button"
                class={styles.collapse}
                aria-label="收起当前步骤"
                onClick={() => emit('collapse')}
              >
                <SvgIcon name="panel-collapse" />
              </button>
            ],
            default: () => (
              <div ref={body} class={styles.body} aria-live="polite">
                {record ? (
                  <StepRecordView
                    record={record}
                    progress={props.progress}
                    started={started}
                    still={reducedMotion()}
                    note={props.note}
                  />
                ) : (
                  <p class={styles.empty}>等待开始</p>
                )}
              </div>
            )
          }}
        </MxPanel>
      );
    };
  }
});
