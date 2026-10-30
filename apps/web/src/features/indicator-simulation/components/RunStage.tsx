import { Back, CircleClose, Operation, VideoPause, VideoPlay } from '@element-plus/icons-vue';
import { MapCanvas } from '@yzt/map-vue';
import { MxPanel, MxSplitLayout } from '@yzt/ui';
import { ElButton, ElMessage, ElPopconfirm, ElRadioButton, ElRadioGroup } from 'element-plus';
import { computed, defineComponent, onBeforeUnmount, type PropType, ref, watch } from 'vue';
import { BasemapCard } from '@/shared/map/basemap/BasemapCard';
import type { Basemap } from '@/shared/map/basemap/useBasemap';
import { JIANGSU_ZOOM_RANGE } from '@/shared/map/jiangsu';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import { MapViewControls } from '@/shared/map/view-controls/MapViewControls';
import { SCROLL_ZOOM_RATES } from '@/shared/map/view-controls/zoom';
import type { ReasoningLog } from '../composables/useReasoningLog';
import type { RunFlow } from '../composables/useRunFlow';
import type { SimulationMap } from '../composables/useSimulationMap';
import type { SimulationModel } from '../composables/useSimulationModel';
import type { SimulationResult } from '../composables/useSimulationResult';
import type { SimulationRun } from '../composables/useSimulationRun';
import type { UserPause } from '../composables/useUserPause';
import type { ApplyOutcome } from '../engine/engine';
import { STEP_GROUPS } from '../engine/steps';
import type { RunView } from '../result/result-view';
import { inProgress } from '../run/run-view';
import { FlowChart } from './FlowChart';
import { InterventionPanel } from './InterventionPanel';
import { ReasoningPanel } from './ReasoningPanel';
import { ResultList } from './ResultList';
import { ResultMapTools } from './ResultMapTools';
import styles from './RunStage.module.scss';
import { SimulationMapOverlay } from './SimulationMapOverlay';
import { StageStepper } from './StageStepper';

// 人工干预浮在流程图右上角：面板宽 400，加上和右边、和树之间的间距；打开时镜头让开这一块
const INTERVENE_ROOM = 400 + 24;

const APPLIED_MESSAGES: Readonly<Record<ApplyOutcome, string | null>> = {
  unchanged: null,
  saved: '参数已保存，执行到对应步骤时生效',
  rerun: '已按调整重新计算'
};

const isView = (value: unknown): value is RunView => value === 'flow' || value === 'result';

/**
 * AI计算与结果展示（原型 v4、v5）：计算时左侧 AI计算的时间线，主区是计算流程图，标题栏是阶段、计算状态、暂停、人工干预和停止；
 * 完成后标题栏只留阶段和"计算流程 / 计算结果"的切换，"查看结果""调整条件"在左侧时间线的底部；
 * 看结果时左侧是计算结果、主区是地图。地图画布在第一次计算完成时才创建，之后切换视图、重新计算都保留
 */
export const RunStage = defineComponent({
  name: 'RunStage',
  props: {
    run: { type: Object as PropType<SimulationRun>, required: true },
    model: { type: Object as PropType<SimulationModel>, required: true },
    flow: { type: Object as PropType<RunFlow>, required: true },
    log: { type: Object as PropType<ReasoningLog>, required: true },
    userPause: { type: Object as PropType<UserPause>, required: true },
    result: { type: Object as PropType<SimulationResult>, required: true },
    simulationMap: { type: Object as PropType<SimulationMap>, required: true },
    /** 页面的底图拥有者和默认视角（ADR 0033）：结果地图右下角的控制栏和底图卡片（ADR 0111） */
    basemap: { type: Object as PropType<Basemap>, required: true },
    goToDefaultView: { type: Function as PropType<() => void>, required: true },
    /** 完成后主区看什么；推演中总是流程图 */
    view: { type: String as PropType<RunView>, default: 'flow' }
  },
  emits: {
    'update:view': (view: RunView) => isView(view)
  },
  setup(props, { emit }) {
    const { run, result } = props;
    const state = run.state;
    const intervening = ref(false);
    const highlight = ref<number | null>(null);
    const basemapOpen = ref(false);
    const done = computed(() => state.value.status === 'done');
    const showingResult = computed(() => done.value && props.view === 'result');
    const current = computed(() => {
      const running = STEP_GROUPS.filter(group =>
        group.steps.some(step => state.value.steps[step].status === 'running')
      );
      return running.at(-1)?.name ?? null;
    });

    // 完成时关掉人工干预（完成后没有这个入口），第一次完成时创建地图
    const mapMounted = ref(false);
    watch(
      done,
      value => {
        if (value) {
          intervening.value = false;
          mapMounted.value = true;
        }
      },
      { immediate: true }
    );

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
      ElMessage.success('已停止计算，配置的条件已保留');
    };

    const onApplied = (outcome: ApplyOutcome) => {
      intervening.value = false;
      const message = APPLIED_MESSAGES[outcome];
      if (message !== null) {
        ElMessage.success(message);
      }
    };

    const showResult = (indicatorId?: string) => {
      if (indicatorId !== undefined) {
        result.select({ indicatorId });
      }
      emit('update:view', 'result');
    };

    const renderState = () => {
      if (state.value.paused) {
        return `已暂停${current.value ? ` · ${current.value}` : ''}`;
      }
      return `计算中 · ${current.value ?? '规划步骤'}`;
    };

    const renderHeader = () => {
      if (done.value) {
        return [
          <StageStepper key="stepper" phase="result" />,
          <ElRadioGroup
            key="view"
            class={styles.views}
            modelValue={props.view}
            aria-label="主区视图"
            onUpdate:modelValue={value => {
              if (isView(value)) {
                emit('update:view', value);
              }
            }}
          >
            <ElRadioButton value="flow">计算流程</ElRadioButton>
            <ElRadioButton value="result">计算结果</ElRadioButton>
          </ElRadioGroup>
        ];
      }
      const running = inProgress(state.value.status);
      const paused = props.userPause.paused.value;
      return [
        <StageStepper key="stepper" phase="running" />,
        <span key="state" class={styles.state} role="status">
          <i class={[styles.stateDot, state.value.paused ? styles.pausedDot : styles.runningDot]} />
          {renderState()}
        </span>,
        // 主次：暂停 / 继续是主按钮，人工干预是默认按钮（打开时浅色主色），停止是红色朴素按钮
        <div key="actions" class={styles.actions}>
          <ElButton
            type="primary"
            icon={paused ? VideoPlay : VideoPause}
            disabled={!running}
            onClick={() => (paused ? props.userPause.resume() : props.userPause.pause())}
          >
            {paused ? '继续' : '暂停'}
          </ElButton>
          <ElButton
            icon={Operation}
            type={intervening.value ? 'primary' : 'default'}
            plain={intervening.value}
            disabled={!running}
            aria-pressed={intervening.value}
            onClick={() => (intervening.value = !intervening.value)}
          >
            人工干预
          </ElButton>
          {running ? (
            <ElPopconfirm
              key="stop"
              title="停止计算？配置的条件会保留"
              confirmButtonText="停止"
              cancelButtonText="继续"
              onConfirm={stop}
            >
              {{
                reference: () => (
                  <ElButton type="danger" plain icon={CircleClose}>
                    停止
                  </ElButton>
                )
              }}
            </ElPopconfirm>
          ) : (
            <ElButton key="recompose" icon={Back} onClick={() => run.stop()}>
              调整条件
            </ElButton>
          )}
        </div>
      ];
    };

    const renderFlow = () => {
      const plan = props.flow.plan.value;
      const frame = props.flow.frame.value;
      return (
        plan &&
        frame && (
          <div key="flow" class={[styles.layer, showingResult.value && styles.concealed]}>
            <FlowChart
              plan={plan}
              frame={frame}
              paused={state.value.paused}
              done={done.value}
              highlight={highlight.value}
              reserveRight={intervening.value ? INTERVENE_ROOM : 0}
              onPick={showResult}
            />
          </div>
        )
      );
    };

    // 地图只放在结果视图里；看流程图时隐藏但保留尺寸，切回来不用重新排版
    const renderMap = () => {
      const conditions = state.value.conditions;
      const selection = result.selection.value;
      return (
        <div key="map" class={[styles.layer, !showingResult.value && styles.concealed]}>
          <MapCanvas mapOptions={JIANGSU_ZOOM_RANGE} scrollZoomRates={SCROLL_ZOOM_RATES} />
          <MapStatusNotice />
          <SimulationMapOverlay
            simulationMap={props.simulationMap}
            focusCity={selection?.cityCode ?? null}
            hoverCity={result.hoverCity.value}
            onFocusCity={cityCode => result.select({ cityCode })}
          />
          {conditions && <ResultMapTools result={result} conditions={conditions} />}
          <div class={styles.mapCorner}>
            <MapViewControls goToDefaultView={props.goToDefaultView} zoomRange={JIANGSU_ZOOM_RANGE} />
            <BasemapCard
              basemap={props.basemap}
              open={basemapOpen.value}
              visible={showingResult.value}
              onUpdate:open={open => (basemapOpen.value = open)}
            />
          </div>
        </div>
      );
    };

    return () => {
      const conditions = state.value.conditions;
      return (
        <div class={styles.root}>
          <MxSplitLayout asideLabel={showingResult.value ? '计算结果' : 'AI计算'}>
            {{
              aside: () =>
                showingResult.value && conditions ? (
                  <ResultList key="result" result={result} conditions={conditions} onRecompose={() => run.stop()} />
                ) : (
                  <ReasoningPanel
                    key="reasoning"
                    run={run}
                    log={props.log}
                    plan={props.flow.plan.value}
                    onHover={column => (highlight.value = column)}
                    onResult={() => showResult()}
                    onRecompose={() => run.stop()}
                  />
                ),
              default: () => (
                <MxPanel class={styles.panel} headerTone="muted" flush>
                  {{
                    header: renderHeader,
                    default: () => (
                      <div class={styles.stack}>
                        {renderFlow()}
                        {mapMounted.value && renderMap()}
                      </div>
                    )
                  }}
                </MxPanel>
              )
            }}
          </MxSplitLayout>
          {intervening.value && (
            <div class={styles.intervene}>
              <InterventionPanel
                run={run}
                model={props.model}
                onApplied={onApplied}
                onClose={() => (intervening.value = false)}
              />
            </div>
          )}
        </div>
      );
    };
  }
});
