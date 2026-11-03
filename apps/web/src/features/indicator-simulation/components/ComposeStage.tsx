import { MxSplitLayout } from '@yzt/ui';
import { computed, defineComponent, type PropType } from 'vue';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { missingConditions } from '../compose/composition';
import { citiesScope } from '../model/scope';
import type { CompositionOwner } from '../composables/useComposition';
import { useConditionDrag } from '../composables/useConditionDrag';
import type { PromptComposer } from '../composables/usePromptComposer';
import type { ScopeEditor } from '../composables/useScopeEditor';
import type { SimulationModel } from '../composables/useSimulationModel';
import { ComposeBoard } from './ComposeBoard';
import { ConditionLibrary } from './ConditionLibrary';
import styles from './ComposeStage.module.scss';

/**
 * 条件编排阶段：左侧推演条件，右侧编排图；条件到编排图的拖放在这里接上。AI 推演指令在页面底部的对话栏，
 * AI 按指令编排期间，推演条件和编排图不接收操作
 */
export const ComposeStage = defineComponent({
  name: 'ComposeStage',
  props: {
    composition: { type: Object as PropType<CompositionOwner>, required: true },
    composer: { type: Object as PropType<PromptComposer>, required: true },
    model: { type: Object as PropType<SimulationModel>, required: true },
    /** 自定义范围的弹窗 */
    editor: { type: Object as PropType<ScopeEditor>, required: true }
  },
  emits: {
    start: () => true,
    retry: () => true
  },
  setup(props, { emit }) {
    const drag = useConditionDrag();
    const pendingScope = computed(
      () =>
        props.composer.asking.value &&
        props.composer.building.value === null &&
        missingConditions(props.composition.state.value.conditions).includes('region')
    );
    const pickCities = (cityCodes: readonly string[]) => {
      const names = cityCodes.map(code => JIANGSU_CITIES.find(city => city.code === code)?.name ?? code);
      props.composer.supplyScope(citiesScope(cityCodes), names.join('、'));
    };
    return () => {
      const building = props.composer.building.value;
      const locked = building !== null && styles.locked;
      return (
        <MxSplitLayout asideLabel="计算条件">
          {{
            aside: () => (
              <ConditionLibrary
                class={locked}
                composition={props.composition}
                drag={drag}
                editor={props.editor}
                pendingScope={pendingScope.value}
              />
            ),
            default: () => (
              <ComposeBoard
                class={locked}
                composition={props.composition}
                drag={drag}
                model={props.model}
                editor={props.editor}
                building={building}
                asking={props.composer.asking.value}
                conflicts={props.composer.conflicts.value}
                onCities={pickCities}
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
