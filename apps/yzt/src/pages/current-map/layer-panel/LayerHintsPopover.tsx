import { usePageActive } from '@mx/map-vue';
import { ElCheckbox, ElPopover } from 'element-plus';
import { computed, defineComponent, type PropType, ref, watch } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import shellStyles from '@/shared/map/layer-panel/LayerPanelShell.module.scss';
import { useLightDismiss } from '@/shared/map/popover/useLightDismiss';
import { LAYER_HINT_GROUPS, LAYER_HINT_TEXTS, LAYER_HINTS, type LayerHint } from './layer-hints';
import type { LayerHints } from './useLayerHints';
import styles from './LayerHintsPopover.module.scss';

// 打开和关闭都自己处理，忽略 Element 的显隐请求
const ignoreVisibility = () => undefined;

/**
 * 面板标题栏的"行内提示"（用户 2026-11-17，ADR 0167）：点开是全部和按类的开关，关掉的一类在图层行内、数据加载的条目和
 * 明细里都不显示；再点入口、单击外部、按 Esc 关闭，页面停用时关闭
 */
export const LayerHintsPopover = defineComponent({
  name: 'LayerHintsPopover',
  props: {
    hints: { type: Object as PropType<LayerHints>, required: true }
  },
  setup(props) {
    const open = ref(false);
    const reference = ref<HTMLElement>();
    const content = ref<HTMLElement>();
    const pageActive = usePageActive();
    watch(pageActive, active => {
      if (!active) {
        open.value = false;
      }
    });
    const off = computed(() => LAYER_HINTS.length - props.hints.shown.value.size);
    const close = () => {
      open.value = false;
      reference.value?.focus({ preventScroll: true });
    };
    useLightDismiss({
      active: () => open.value,
      contains: target =>
        reference.value?.contains(target) === true || content.value?.closest('.el-popper')?.contains(target) === true,
      onOutside: () => (open.value = false),
      onEscape: close
    });

    const renderItem = (hint: LayerHint) => (
      <div key={hint} class={styles.item}>
        <ElCheckbox
          size="small"
          modelValue={props.hints.shown.value.has(hint)}
          data-layer-hint={hint}
          onUpdate:modelValue={(value: unknown) => props.hints.setShown(hint, value === true)}
        >
          {LAYER_HINT_TEXTS[hint].name}
        </ElCheckbox>
        <span class={styles.detail}>{LAYER_HINT_TEXTS[hint].detail}</span>
      </div>
    );

    return () => {
      const label = off.value === 0 ? '行内提示' : `行内提示（关掉了 ${off.value} 类）`;
      return (
        <ElPopover
          trigger="click"
          triggerKeys={[]}
          placement="right-start"
          fallbackPlacements={['bottom-end', 'bottom']}
          strategy="fixed"
          width={260}
          offset={12}
          showArrow={false}
          persistent={false}
          popperStyle={{ padding: 0 }}
          visible={open.value}
          onUpdate:visible={ignoreVisibility}
        >
          {{
            reference: () => (
              <button
                ref={reference}
                type="button"
                class={[shellStyles.headerButton, off.value > 0 && styles.partial]}
                aria-label={label}
                aria-haspopup="dialog"
                title={label}
                data-layer-hints
                onClick={() => (open.value = !open.value)}
              >
                <SvgIcon name="header-bell" size={16} />
              </button>
            ),
            default: () => (
              <div ref={content} class={styles.content} role="dialog" aria-label="行内提示" data-layer-hints-popover>
                <div class={styles.head}>
                  <span class={styles.title}>行内提示</span>
                  <ElCheckbox
                    size="small"
                    modelValue={off.value === 0}
                    indeterminate={off.value > 0 && off.value < LAYER_HINTS.length}
                    data-layer-hint="all"
                    onUpdate:modelValue={(value: unknown) => props.hints.setAll(value === true)}
                  >
                    全部
                  </ElCheckbox>
                </div>
                {LAYER_HINT_GROUPS.map(group => (
                  <div key={group.title} class={styles.group}>
                    <span class={styles.groupTitle}>{group.title}</span>
                    {group.hints.map(renderItem)}
                  </div>
                ))}
              </div>
            )
          }}
        </ElPopover>
      );
    };
  }
});
