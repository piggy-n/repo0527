import { ElSwitch } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import type { ResourceRecord } from '../api';

/** 显示值只跟随接口记录；即时禁用防重复，加载图标延迟出现 */
export const ResourceStatusSwitch = defineComponent({
  name: 'ResourceStatusSwitch',
  props: {
    row: { type: Object as PropType<ResourceRecord>, required: true },
    pending: Boolean,
    disabled: Boolean
  },
  emits: { toggle: () => true },
  setup(props, { emit }) {
    const loading = useDelayedFlag(() => props.pending);
    // ElSwitch 会先改内部 checked；用 beforeChange 发出意图并拒绝内部切换，等待真实结果
    function requestChange() {
      emit('toggle');
      return false;
    }
    return () => <ElSwitch
      size="small"
      modelValue={props.row.enabled}
      disabled={props.disabled || props.pending}
      loading={loading.value}
      activeText="启用"
      inactiveText="停用"
      inlinePrompt
      aria-label={`${props.row.name}启用状态`}
      beforeChange={requestChange}
    />;
  }
});
