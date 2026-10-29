import { ElMessage } from 'element-plus';
import { defineComponent } from 'vue';
import { ComposeStage } from '@/features/indicator-simulation/components/ComposeStage';
import { useComposition } from '@/features/indicator-simulation/composables/useComposition';
import { useSimulationModel } from '@/features/indicator-simulation/composables/useSimulationModel';

// 推演界面在 S6 接入，先提示
const start = () => {
  ElMessage.info('推演界面正在开发，下一步接入');
};

/**
 * 指标智能推演（ADR 0102）：条件编排 → AI 推演 → 结果展示，全部是确定性的模拟数据，不请求后端。
 * 分步实施中：现在只有条件编排，推演界面在 S6 接入（docs/modules/indicator-simulation.md）
 */
export const IndicatorSimulationPage = defineComponent({
  name: 'IndicatorSimulationPage',
  setup() {
    const composition = useComposition();
    const { model, retry } = useSimulationModel();
    return () => <ComposeStage composition={composition} model={model.value} onStart={start} onRetry={retry} />;
  }
});
