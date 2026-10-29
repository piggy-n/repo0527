import { MxTitle } from '@yzt/ui';
import { ElButton } from 'element-plus';
import { computed, defineComponent, type PropType, shallowRef } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { SimulationModel } from '../composables/useSimulationModel';
import {
  changedParams,
  PARAM_LABELS,
  type ParamKey,
  type SimulationConditions,
  type SimulationParams
} from '../model/params';
import { ParamEstimate } from './ParamEstimate';
import { ParamFields } from './ParamFields';
import styles from './ParamPopover.module.scss';

/** 编排图上参数节点的编辑浮层：改一项参数，即时预估，确定后才交给拥有者 */
export const ParamPopover = defineComponent({
  name: 'ParamPopover',
  props: {
    paramKey: { type: String as PropType<ParamKey>, required: true },
    model: { type: Object as PropType<SimulationModel>, required: true },
    conditions: { type: Object as PropType<SimulationConditions>, required: true },
    params: { type: Object as PropType<SimulationParams>, required: true }
  },
  emits: {
    apply: (params: SimulationParams) => typeof params === 'object',
    cancel: () => true
  },
  setup(props, { emit }) {
    // 浮层关闭时卸载，草稿随之丢弃
    const draft = shallowRef(props.params);
    const changed = computed(() => changedParams(props.params, draft.value).length > 0);

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        emit('cancel');
      }
    };

    return () => {
      const label = PARAM_LABELS[props.paramKey];
      return (
        <div class={styles.root} role="dialog" aria-label={label} onKeydown={onKeydown}>
          <div class={styles.header}>
            <MxTitle level="panel">{{ default: () => label, icon: () => <SvgIcon name="simulation-tune" /> }}</MxTitle>
            <button type="button" class={styles.close} aria-label="关闭" onClick={() => emit('cancel')}>
              <SvgIcon name="close" />
            </button>
          </div>
          <div class={styles.body}>
            <ParamEstimate
              model={props.model}
              conditions={props.conditions}
              base={props.params}
              draft={draft.value}
              note={changed.value ? '保存到计算参数，开始推演时使用' : '参数未变化'}
            />
            <ParamFields
              class={styles.fields}
              keys={[props.paramKey]}
              conditions={props.conditions}
              modelValue={draft.value}
              onUpdate:modelValue={params => (draft.value = params)}
            />
          </div>
          <div class={styles.footer}>
            <span class={styles.hint}>预估按同一模型即时计算</span>
            <ElButton onClick={() => emit('cancel')}>取消</ElButton>
            <ElButton type="primary" disabled={!changed.value} onClick={() => emit('apply', draft.value)}>
              确定
            </ElButton>
          </div>
        </div>
      );
    };
  }
});
