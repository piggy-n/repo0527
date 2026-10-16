import { useMap } from '@yzt/map-vue';
import { ElOption, ElSelect, ElSlider, ElTooltip } from 'element-plus';
import { computed, defineComponent, nextTick, type PropType, ref, type VNode } from 'vue';
import { useSortableList } from '@/shared/composables/useSortableList';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { ResourceLayers } from '../composables/useResourceLayers';
import { type CheckedLayer, checkedDropTarget, checkedLayers, moveTarget } from '../layer-panel';
import { resourceNotices } from '../resource-notices';
import { arrowStep } from './ResourceTreeList';
import styles from './CheckedLayerList.module.scss';

const HANDLE = '[data-drag-handle="checked"]';

/**
 * "已勾选"（ADR 0053 第 6 节）：按叠放顺序从上到下，拖动手柄调整叠放顺序（上层优先显示），交给拥有者的 move；
 * 每一行是年份、名称、透明度、取消勾选。最小显示级别收进名称后的信息图标，配置错误、瓦片加载失败直接显示
 */
export const CheckedLayerList = defineComponent({
  name: 'CheckedLayerList',
  props: {
    layers: { type: Object as PropType<ResourceLayers>, required: true }
  },
  setup(props) {
    const camera = useMap().useCamera();
    const list = ref<HTMLElement>();
    const items = computed(() => checkedLayers(props.layers.state.value));
    // 哪个资源的透明度滑块打开着：面板自己的界面状态
    const opacityOpen = ref<ReadonlySet<string>>(new Set());

    const moveTo = (code: string, target: number | null) => {
      if (target !== null) {
        props.layers.move(code, target);
      }
    };

    useSortableList(list, {
      handle: HANDLE,
      draggable: '>[data-sortable-item]',
      onMove: (from, to) => {
        const code = items.value[from]?.code;
        if (code !== undefined) {
          moveTo(code, checkedDropTarget(props.layers.state.value, code, to));
        }
      }
    });

    // 手柄上按上下方向键移动一位；移动后焦点回到这个手柄上
    const onHandleKeydown = async (event: KeyboardEvent, code: string) => {
      const step = arrowStep(event);
      if (step === 0) {
        return;
      }
      event.preventDefault();
      moveTo(code, moveTarget(props.layers.state.value, code, step < 0 ? 'up' : 'down'));
      await nextTick();
      const handles = list.value?.querySelectorAll<HTMLElement>(HANDLE) ?? [];
      [...handles].find(handle => handle.dataset.code === code)?.focus();
    };

    const toggleOpacity = (code: string) => {
      const next = new Set(opacityOpen.value);
      if (!next.delete(code)) {
        next.add(code);
      }
      opacityOpen.value = next;
    };

    // 滑块按百分比显示，拖动过程中实时生效
    const changeOpacity = (code: string, value: number | number[]) => {
      if (typeof value === 'number') {
        props.layers.setOpacity(code, value / 100);
      }
    };

    const renderYear = (layer: CheckedLayer) =>
      layer.years.length > 1 ? (
        <ElSelect
          class={[styles.year, 'select-no-arrow']}
          size="small"
          modelValue={layer.year}
          aria-label={`${layer.name}的年份`}
          onUpdate:modelValue={(year: number) => props.layers.setYear(layer.code, year)}>
          {layer.years.map(year => (
            <ElOption key={year} label={String(year)} value={year} />
          ))}
        </ElSelect>
      ) : (
        <span class={[styles.year, styles.yearText]}>{layer.year}</span>
      );

    const renderLayer = (layer: CheckedLayer): VNode => {
      const { layers: owner } = props;
      const display = owner.state.value.displays.get(layer.code);
      const notices = resourceNotices({
        checked: display?.checked ?? false,
        configError: owner.configErrors.value.has(layer.code),
        tileError: owner.tileErrors.value.has(layer.code),
        minzoom: owner.minzoomOf(layer.code),
        zoom: camera.value.zoom
      });
      const minzoom = notices.find(notice => notice.kind === 'minzoom');
      const shown = notices.filter(notice => notice.kind !== 'minzoom');
      const sliderOpen = opacityOpen.value.has(layer.code);
      const percent = Math.round(layer.opacity * 100);
      return (
        <li key={layer.code} data-sortable-item data-layer={layer.code}>
          <div class={styles.row}>
            <button
              type="button"
              class={styles.handle}
              data-drag-handle="checked"
              data-code={layer.code}
              aria-label={`调整叠放顺序：${layer.name}`}
              title="调整叠放顺序（上层优先显示）"
              onKeydown={event => void onHandleKeydown(event, layer.code)}>
              <SvgIcon name="drag-handle" size={16} />
            </button>
            {renderYear(layer)}
            <span class={styles.name}>
              <span class={styles.nameText} title={layer.name}>
                {layer.name}
              </span>
              {minzoom && (
                <ElTooltip content={minzoom.text} placement="top">
                  <span class={styles.info} tabindex={0} role="img" aria-label={minzoom.text}>
                    <SvgIcon name="info" size={14} />
                  </span>
                </ElTooltip>
              )}
            </span>
            <button
              type="button"
              class={[styles.opacity, sliderOpen && styles.opacityOpen]}
              aria-label={`${layer.name}的透明度`}
              aria-expanded={sliderOpen}
              onClick={() => toggleOpacity(layer.code)}>
              {percent}%
            </button>
            <button
              type="button"
              class={styles.remove}
              aria-label={`取消勾选${layer.name}`}
              title="取消勾选"
              onClick={() => owner.setChecked(layer.code, false)}>
              <SvgIcon name="close" size={16} />
            </button>
          </div>
          {shown.map(notice => (
            <div
              key={notice.kind}
              class={[styles.extra, notice.kind === 'config-error' ? styles.error : styles.warning]}>
              {notice.text}
            </div>
          ))}
          {sliderOpen && (
            <div class={styles.sliderRow}>
              <ElSlider
                class={styles.slider}
                size="small"
                modelValue={percent}
                aria-label={`${layer.name}的透明度`}
                formatTooltip={(value: number) => `${value}%`}
                onUpdate:modelValue={value => changeOpacity(layer.code, value)}
              />
            </div>
          )}
        </li>
      );
    };

    return () =>
      items.value.length > 0 ? (
        <ul ref={list} class={styles.list}>
          {items.value.map(renderLayer)}
        </ul>
      ) : (
        <div class={styles.empty}>勾选资源后在这里调整叠放顺序和透明度</div>
      );
  }
});
