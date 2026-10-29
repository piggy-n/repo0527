import { defineComponent } from 'vue';
import { ComposeStage } from '@/features/indicator-simulation/components/ComposeStage';
import { RunStage } from '@/features/indicator-simulation/components/RunStage';
import { useComposition } from '@/features/indicator-simulation/composables/useComposition';
import { useSimulationModel } from '@/features/indicator-simulation/composables/useSimulationModel';
import { useSimulationRun } from '@/features/indicator-simulation/composables/useSimulationRun';

/**
 * 指标智能推演（ADR 0102）：条件编排 → AI 推演 → 结果展示，全部是确定性的模拟数据，不请求后端。
 * 推演空闲时是条件编排，开始后是推演阶段；停止或重新编排回到条件编排，编排的条件保留。
 * 分步实施中：地图在 S7、结果在 S8 接入（docs/modules/indicator-simulation.md）
 */
export const IndicatorSimulationPage = defineComponent({
  name: 'IndicatorSimulationPage',
  setup() {
    const composition = useComposition();
    const { model, retry } = useSimulationModel();
    const run = useSimulationRun();

    const start = () => {
      const current = model.value;
      if (current.status === 'ready') {
        run.start(composition.state.value, current.calculator);
      }
    };

    return () =>
      run.state.value.status === 'idle' ? (
        <ComposeStage key="compose" composition={composition} model={model.value} onStart={start} onRetry={retry} />
      ) : (
        <RunStage key="run" run={run} model={model.value} />
      );
  }
});
