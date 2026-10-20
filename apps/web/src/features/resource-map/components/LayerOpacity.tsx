import { ElPopover, ElSlider } from 'element-plus';
import { computed, defineComponent, ref, watch } from 'vue';
import { usePageActive } from '@/shared/composables/usePageActive';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import styles from './LayerOpacity.module.scss';

/** 资源树和已勾选列表共用的透明度浮层；数值由图层拥有者持有，100% 表示完全显示 */
export const LayerOpacity = defineComponent({
  name: 'LayerOpacity',
  props: {
    name: { type: String, required: true },
    modelValue: { type: Number, required: true }
  },
  emits: {
    'update:modelValue': (value: number) => Number.isFinite(value) && value >= 0 && value <= 1
  },
  setup(props, { emit }) {
    // 打开状态只属于入口，页面停用时关闭挂在 body 上的浮层
    const open = ref(false);
    const pageActive = usePageActive();
    const percent = computed(() => Math.round(props.modelValue * 100));
    watch(pageActive, active => {
      if (!active) {
        open.value = false;
      }
    });
    const change = (value: number | number[]) => {
      if (typeof value === 'number') {
        emit('update:modelValue', value / 100);
      }
    };
    // 操作按钮和滑块不触发资源行的选择或拖动
    const stop = (event: Event) => event.stopPropagation();

    return () => (
      <span class={[styles.root, open.value && styles.open]} onClick={stop} onPointerdown={stop}>
        <ElPopover
          trigger="click"
          placement="right"
          width={240}
          persistent={false}
          visible={open.value}
          onUpdate:visible={(visible: boolean) => (open.value = visible && pageActive.value)}>
          {{
            reference: () => (
              <button
                type="button"
                class={styles.trigger}
                aria-label={`${props.name}的透明度`}
                aria-expanded={open.value}
                title={`透明度 ${percent.value}%`}>
                <SvgIcon name="layer-opacity" size={16} />
              </button>
            ),
            default: () => (
              <div onClick={stop} onPointerdown={stop}>
                <div class={styles.heading}>
                  <strong>透明度</strong>
                  <span class={styles.name}>{props.name}</span>
                </div>
                <div class={styles.controls}>
                  <ElSlider
                    class={styles.slider}
                    size="small"
                    modelValue={percent.value}
                    aria-label={`${props.name}的透明度`}
                    formatTooltip={(value: number) => `${value}%`}
                    onUpdate:modelValue={change}
                  />
                  <output class={styles.value}>{percent.value}%</output>
                </div>
                <div class={styles.ends}><span>完全透明</span><span>完全显示</span></div>
              </div>
            )
          }}
        </ElPopover>
      </span>
    );
  }
});
