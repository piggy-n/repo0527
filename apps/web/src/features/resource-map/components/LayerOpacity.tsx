import { ElPopover, ElSlider } from 'element-plus';
import { computed, defineComponent } from 'vue';
import { usePageActive } from '@/shared/composables/usePageActive';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { useLayerOpacityPopup } from '../composables/useLayerOpacityPopup';
import styles from './LayerOpacity.module.scss';

// 操作按钮和滑块不触发资源行的选择或拖动
const stop = (event: Event) => event.stopPropagation();

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
    const popup = useLayerOpacityPopup(usePageActive());
    const percent = computed(() => Math.round(props.modelValue * 100));
    const change = (value: number | number[]) => {
      if (typeof value === 'number') {
        emit('update:modelValue', value / 100);
      }
    };
    return () => (
      <span class={[styles.root, popup.open.value && styles.open]} onClick={stop} onPointerdown={stop}>
        <ElPopover
          trigger="click"
          placement="right"
          strategy="fixed"
          popperOptions={{
            modifiers: [{ name: 'preventOverflow', options: { padding: 8, altAxis: true, tether: false } }]
          }}
          width={240}
          popperStyle={{ padding: 0 }}
          persistent={false}
          visible={popup.open.value}
          onUpdate:visible={popup.setOpen}
        >
          {{
            reference: () => (
              <button
                type="button"
                class={styles.trigger}
                aria-label={`${props.name}的透明度`}
                aria-expanded={popup.open.value}
                aria-pressed={popup.open.value}
                title={`透明度 ${percent.value}%`}
                onMouseenter={popup.enter}
                onMouseleave={popup.leave}
              >
                <SvgIcon name="layer-opacity" size={16} />
              </button>
            ),
            default: () => (
              <div
                class={styles.content}
                onMouseenter={popup.enter}
                onMouseleave={popup.leave}
                onClick={stop}
                onPointerdown={event => {
                  stop(event);
                  popup.beginPointer(event);
                }}>
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
                    showTooltip={false}
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
