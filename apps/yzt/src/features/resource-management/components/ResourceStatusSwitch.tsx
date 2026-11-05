import { ElSwitch } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { useDelayedFlag } from '@/shared/composables/useDelayedFlag';
import type { ResourceRecord } from '../api';

/** 启停开关：显示的值只跟随接口记录；进行中立即禁用防重复，加载图标延迟出现 */
export const ResourceStatusSwitch = defineComponent({
  name: 'ResourceStatusSwitch',
  props: {
    row: { type: Object as PropType<ResourceRecord>, required: true },
    pending: Boolean,
    disabled: Boolean
  },
  emits: {
    toggle: () => true
  },
  setup(props, { emit }) {
    const loading = useDelayedFlag(() => props.pending);

    // ElSwitch 点击后会先改自己的选中状态：在 beforeChange 里发出意图并拒绝切换，等接口结果刷新记录
    function requestChange() {
      emit('toggle');
      return false;
    }

    return () => (
      <ElSwitch
        size="small"
        modelValue={props.row.enabled}
        disabled={props.disabled || props.pending}
        loading={loading.value}
        aria-label={`${props.row.name}启用状态`}
        beforeChange={requestChange}
      />
    );
  }
});
