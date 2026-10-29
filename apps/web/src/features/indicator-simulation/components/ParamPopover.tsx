import { MxTitle } from '@yzt/ui';
import { ElButton } from 'element-plus';
import { computed, defineComponent, type PropType, shallowRef } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import {
  changedParams,
  PARAM_LABELS,
  type ParamKey,
  type SimulationConditions,
  type SimulationParams
} from '../model/params';
import { ParamFields } from './ParamFields';
import styles from './ParamPopover.module.scss';

/** 编排图上参数节点的编辑浮层：只改这一项参数，草稿交给编排图预估，确定后才交给拥有者 */
export const ParamPopover = defineComponent({
  name: 'ParamPopover',
  props: {
    paramKey: { type: String as PropType<ParamKey>, required: true },
    conditions: { type: Object as PropType<SimulationConditions>, required: true },
    params: { type: Object as PropType<SimulationParams>, required: true }
  },
  emits: {
    /** 草稿变了：编排图下方的预估按它显示 */
    preview: (params: SimulationParams) => typeof params === 'object',
    apply: (params: SimulationParams) => typeof params === 'object',
    cancel: () => true
  },
  setup(props, { emit }) {
    // 浮层关闭时卸载，草稿随之丢弃
    const draft = shallowRef(props.params);
    const changed = computed(() => changedParams(props.params, draft.value).length > 0);
    const update = (next: SimulationParams) => {
      draft.value = next;
      emit('preview', next);
    };

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
            <ParamFields
              bare
              keys={[props.paramKey]}
              conditions={props.conditions}
              modelValue={draft.value}
              onUpdate:modelValue={update}
            />
          </div>
          <div class={styles.footer}>
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
