import { MxSplitLayout } from '@yzt/ui';
import { defineComponent, type PropType } from 'vue';
import type { CompositionOwner } from '../composables/useComposition';
import { useConditionDrag } from '../composables/useConditionDrag';
import type { SimulationModel } from '../composables/useSimulationModel';
import { ComposeBoard } from './ComposeBoard';
import { ConditionLibrary } from './ConditionLibrary';

/** 条件编排阶段：左侧条件库，右侧编排图；两者之间的拖放在这里接上 */
export const ComposeStage = defineComponent({
  name: 'ComposeStage',
  props: {
    composition: { type: Object as PropType<CompositionOwner>, required: true },
    model: { type: Object as PropType<SimulationModel>, required: true }
  },
  emits: {
    start: () => true,
    retry: () => true
  },
  setup(props, { emit }) {
    const drag = useConditionDrag();
    return () => (
      <MxSplitLayout asideLabel="条件库">
        {{
          aside: () => <ConditionLibrary composition={props.composition} drag={drag} />,
          default: () => (
            <ComposeBoard
              composition={props.composition}
              drag={drag}
              model={props.model}
              onStart={() => emit('start')}
              onRetry={() => emit('retry')}
            />
          )
        }}
      </MxSplitLayout>
    );
  }
});
