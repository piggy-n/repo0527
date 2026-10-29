import { CircleClose, Operation, VideoPause, VideoPlay } from '@element-plus/icons-vue';
import { MxPanel, MxSplitLayout } from '@yzt/ui';
import { ElButton, ElMessage, ElPopconfirm } from 'element-plus';
import { computed, defineComponent, onBeforeUnmount, type PropType, ref, watch } from 'vue';
import type { ReasoningLog } from '../composables/useReasoningLog';
import type { RunFlow } from '../composables/useRunFlow';
import type { SimulationModel } from '../composables/useSimulationModel';
import type { SimulationRun } from '../composables/useSimulationRun';
import type { UserPause } from '../composables/useUserPause';
import type { ApplyOutcome } from '../engine/engine';
import { STEP_GROUPS } from '../engine/steps';
import { inProgress } from '../run/run-view';
import { FlowChart } from './FlowChart';
import { InterventionPanel } from './InterventionPanel';
import { ReasoningPanel } from './ReasoningPanel';
import styles from './RunStage.module.scss';
import { StageStepper } from './StageStepper';

// 人工干预浮在流程图右上角：面板宽 400，加上和右边、和树之间的间距；打开时镜头让开这一块
const INTERVENE_ROOM = 400 + 24;

const APPLIED_MESSAGES: Readonly<Record<ApplyOutcome, string | null>> = {
  unchanged: null,
  saved: '参数已保存，执行到对应步骤时生效',
  rerun: '已按调整重新推演'
};

/**
 * AI 推演阶段（原型 v4）：左侧 AI 推理（思维链、打字和对话），右侧推演流程图；标题栏是阶段、推演状态、暂停、人工干预和停止。
 * 完成后流程图看全览，底部的卡片进入结果展示或重新编排
 */
export const RunStage = defineComponent({
  name: 'RunStage',
  props: {
    run: { type: Object as PropType<SimulationRun>, required: true },
    model: { type: Object as PropType<SimulationModel>, required: true },
    flow: { type: Object as PropType<RunFlow>, required: true },
    log: { type: Object as PropType<ReasoningLog>, required: true },
    userPause: { type: Object as PropType<UserPause>, required: true }
  },
  emits: {
    showResult: () => true
  },
  setup(props, { emit }) {
    const { run } = props;
    const state = run.state;
    const intervening = ref(false);
    const highlight = ref<number | null>(null);
    const done = computed(() => state.value.status === 'done');
    const current = computed(() => {
      const running = STEP_GROUPS.filter(group => group.steps.some(step => state.value.steps[step].status === 'running'));
      return running.at(-1)?.name ?? null;
    });

    // 打开人工干预时暂停，关闭后继续
    let release: (() => void) | null = null;
    watch(intervening, open => {
      release?.();
      release = open ? run.pause() : null;
    });
    onBeforeUnmount(() => release?.());

    const stop = () => {
      intervening.value = false;
      run.stop();
      ElMessage.success('已停止推演，编排的条件已保留');
    };

    const onApplied = (outcome: ApplyOutcome) => {
      intervening.value = false;
      const message = APPLIED_MESSAGES[outcome];
      if (message !== null) {
        ElMessage.success(message);
      }
    };

    const renderState = () => {
      if (done.value) {
        return '推演完成';
      }
      if (state.value.paused) {
        return `已暂停${current.value ? ` · ${current.value}` : ''}`;
      }
      return `推演中 · ${current.value ?? '规划步骤'}`;
    };

    const renderHeader = () => {
      const running = inProgress(state.value.status);
      const paused = props.userPause.paused.value;
      return [
        <StageStepper key="stepper" phase={done.value ? 'result' : 'running'} />,
        <span key="state" class={styles.state} role="status">
          <i class={[styles.stateDot, done.value ? styles.doneDot : state.value.paused ? styles.pausedDot : styles.runningDot]} />
          {renderState()}
        </span>,
        <div key="actions" class={styles.actions}>
          <ElButton
            icon={paused ? VideoPlay : VideoPause}
            disabled={!running}
            onClick={() => (paused ? props.userPause.resume() : props.userPause.pause())}
          >
            {paused ? '继续' : '暂停'}
          </ElButton>
          <ElButton
            icon={Operation}
            type={intervening.value ? 'primary' : 'default'}
            disabled={!running && !done.value}
            aria-pressed={intervening.value}
            onClick={() => (intervening.value = !intervening.value)}
          >
            人工干预
          </ElButton>
          {running ? (
            <ElPopconfirm key="stop" title="停止推演？编排的条件会保留" confirmButtonText="停止" cancelButtonText="继续" onConfirm={stop}>
              {{ reference: () => <ElButton icon={CircleClose}>停止</ElButton> }}
            </ElPopconfirm>
          ) : (
            <ElButton key="recompose" onClick={() => run.stop()}>
              重新编排
            </ElButton>
          )}
        </div>
      ];
    };

    const renderDone = () => {
      const plan = props.flow.plan.value;
      return (
        <div class={styles.doneCard}>
          <span class={styles.orb} aria-hidden="true" />
          <div class={styles.doneText}>
            <b>推演完成</b>
            <p title={plan?.summaries.evaluate}>{plan?.summaries.evaluate}</p>
          </div>
          <ElButton type="primary" onClick={() => emit('showResult')}>
            查看结果
          </ElButton>
          <ElButton onClick={() => run.stop()}>重新编排</ElButton>
        </div>
      );
    };

    return () => {
      const plan = props.flow.plan.value;
      const frame = props.flow.frame.value;
      return (
        <div class={styles.root}>
          <MxSplitLayout asideLabel="AI 推理">
            {{
              aside: () => (
                <ReasoningPanel run={run} log={props.log} plan={plan} onHover={column => (highlight.value = column)} />
              ),
              default: () => (
                <MxPanel class={styles.panel} headerTone="muted" flush>
                  {{
                    header: renderHeader,
                    default: () =>
                      plan &&
                      frame && (
                        <FlowChart
                          plan={plan}
                          frame={frame}
                          paused={state.value.paused}
                          done={done.value}
                          highlight={highlight.value}
                          reserveRight={intervening.value ? INTERVENE_ROOM : 0}
                        >
                          {{ default: () => (done.value ? renderDone() : null) }}
                        </FlowChart>
                      )
                  }}
                </MxPanel>
              )
            }}
          </MxSplitLayout>
          {intervening.value && (
            <div class={styles.intervene}>
              <InterventionPanel run={run} model={props.model} onApplied={onApplied} onClose={() => (intervening.value = false)} />
            </div>
          )}
        </div>
      );
    };
  }
});
