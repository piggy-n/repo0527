import { defineComponent, ref, type SlotsType, type VNodeChild } from 'vue';
import { AREA_FILE_ACCEPT } from '@/shared/map/area/area-file';

/** 选择范围文件：插槽里的按钮调用 open 打开文件对话框，选好后发出 pick；可以多选（同一组 Shapefile）。open 也暴露给父组件 */
export const AreaFilePicker = defineComponent({
  name: 'AreaFilePicker',
  emits: {
    pick: (files: File[]) => files.length > 0
  },
  slots: Object as SlotsType<{ default: { readonly open: () => void } }>,
  setup(_, { emit, expose, slots }) {
    const input = ref<HTMLInputElement | null>(null);
    const open = () => input.value?.click();
    expose({ open });
    const onChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }
      const files = [...(target.files ?? [])];
      // 清空后同一个文件可以再选一次
      target.value = '';
      if (files.length > 0) {
        emit('pick', files);
      }
    };
    return (): VNodeChild => [
      slots.default({ open }),
      <input ref={input} type="file" accept={AREA_FILE_ACCEPT} multiple hidden onChange={onChange} />
    ];
  }
});
