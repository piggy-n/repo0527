import { ElButton, ElPopover } from 'element-plus';
import { defineComponent, type PropType, ref, shallowRef, type SlotsType, type VNodeChild } from 'vue';
import { JIANGSU_CITIES, shortRegionName } from '@/shared/map/region/region-catalog';
import styles from './CityPicker.module.scss';

/** 引导卡的选项在卡片底部：浮层让到卡片上面，不挡住 AI 问的话 */
const GUIDE_SELECTOR = '[data-guide]';
const GAP = 8;

/**
 * 选择城市：可以多选，确定后算一次补充完成（ADR 0129）；条件库里逐个点选不算完成，那里不会自动开始。
 * 触发元素是外层的 span：Element 在触发元素重新渲染时会去掉它上面的 aria 属性
 */
export const CityPicker = defineComponent({
  name: 'CityPicker',
  props: {
    placement: { type: String as PropType<'top-start' | 'bottom'>, default: 'top-start' }
  },
  emits: {
    pick: (cityCodes: readonly string[]) => cityCodes.length > 0
  },
  slots: Object as SlotsType<{ reference: { readonly open: boolean } }>,
  setup(props, { emit, slots }) {
    const trigger = ref<HTMLElement | null>(null);
    const open = ref(false);
    const offset = ref(GAP);
    const picks = shallowRef<ReadonlySet<string>>(new Set());

    const onVisible = (visible: boolean) => {
      open.value = visible;
      if (!visible) {
        return;
      }
      picks.value = new Set();
      const guide = trigger.value?.closest(GUIDE_SELECTOR);
      const top = trigger.value?.getBoundingClientRect().top;
      offset.value = guide && top !== undefined ? top - guide.getBoundingClientRect().top + GAP : GAP;
    };

    const toggle = (code: string) => {
      const next = new Set(picks.value);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      picks.value = next;
    };

    const confirm = () => {
      open.value = false;
      emit(
        'pick',
        JIANGSU_CITIES.map(city => city.code).filter(code => picks.value.has(code))
      );
    };

    return (): VNodeChild => (
      <ElPopover
        trigger="click"
        placement={props.placement}
        width={300}
        offset={offset.value}
        persistent={false}
        visible={open.value}
        onUpdate:visible={onVisible}
      >
        {{
          reference: () => (
            <span ref={trigger} class={styles.trigger}>
              {slots.reference({ open: open.value })}
            </span>
          ),
          default: () => (
            <div class={styles.panel} role="group" aria-label="选择城市">
              <div class={styles.grid}>
                {JIANGSU_CITIES.map(city => (
                  <button
                    key={city.code}
                    type="button"
                    class={styles.chip}
                    aria-pressed={picks.value.has(city.code)}
                    title={city.name}
                    onClick={() => toggle(city.code)}
                  >
                    {shortRegionName(city.name)}
                  </button>
                ))}
              </div>
              <div class={styles.footer}>
                <span>{picks.value.size > 0 ? `已选 ${picks.value.size} 个市` : '可以多选'}</span>
                <ElButton type="primary" size="small" disabled={picks.value.size === 0} onClick={confirm}>
                  确定
                </ElButton>
              </div>
            </div>
          )
        }}
      </ElPopover>
    );
  }
});
