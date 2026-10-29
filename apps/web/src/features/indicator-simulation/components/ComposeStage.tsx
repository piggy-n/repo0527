import { MxSplitLayout } from '@yzt/ui';
import { defineComponent, type PropType } from 'vue';
import type { CompositionOwner } from '../composables/useComposition';
import { useConditionDrag } from '../composables/useConditionDrag';
import type { PromptComposer } from '../composables/usePromptComposer';
import type { SimulationModel } from '../composables/useSimulationModel';
import { AiPromptPanel } from './AiPromptPanel';
import { ComposeBoard } from './ComposeBoard';
import { ConditionLibrary } from './ConditionLibrary';
import styles from './ComposeStage.module.scss';

/**
 * 条件编排阶段：左侧上方 AI 推演指令、下方推演条件，右侧编排图；条件到编排图的拖放在这里接上。
 * AI 按指令编排期间，推演条件和编排图不接收操作
 */
export const ComposeStage = defineComponent({
  name: 'ComposeStage',
  props: {
    composition: { type: Object as PropType<CompositionOwner>, required: true },
    composer: { type: Object as PropType<PromptComposer>, required: true },
    model: { type: Object as PropType<SimulationModel>, required: true }
  },
  emits: {
    start: () => true,
    retry: () => true
  },
  setup(props, { emit }) {
    const drag = useConditionDrag();
    return () => {
      const building = props.composer.building.value;
      const locked = building !== null && styles.locked;
      return (
        <MxSplitLayout asideLabel="推演条件">
          {{
            aside: () => (
              <div class={styles.aside}>
                <AiPromptPanel composer={props.composer} />
                <ConditionLibrary class={locked} composition={props.composition} drag={drag} />
              </div>
            ),
            default: () => (
              <ComposeBoard
                class={locked}
                composition={props.composition}
                drag={drag}
                model={props.model}
                building={building}
                onStart={() => emit('start')}
                onRetry={() => emit('retry')}
              />
            )
          }}
        </MxSplitLayout>
      );
    };
  }
});
