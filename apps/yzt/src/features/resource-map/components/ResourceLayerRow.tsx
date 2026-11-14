import { ElOption, ElSelect, ElTooltip } from 'element-plus';
import { computed, defineComponent, type PropType } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import rowStyles from '@/shared/map/layer-panel/layer-row.module.scss';
import { MAP_TOOLTIP_PROPS } from '@/shared/map/tooltip';
import type { ResourceLayers } from '../composables/useResourceLayers';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import { legendEntry } from '../legend';
import { resourceStatuses } from '../resource-status';
import { LegendPreview } from './LegendPreview';
import { ResourceStatusIcon } from './ResourceStatusIcon';

/**
 * 当前图层里一个资源的行内容（ADR 0157），放在通用分组的手柄、复选框后面：符号（点了选中并打开图例）、名称、
 * 紧跟名称的状态图标（ADR 0059）、年份（多年份是不带箭头的小下拉）、移除。拥有者里没有这个资源时不显示
 */
export const ResourceLayerRow = defineComponent({
  name: 'ResourceLayerRow',
  props: {
    layers: { type: Object as PropType<ResourceLayers>, required: true },
    symbols: { type: Object as PropType<Pick<ResourceSymbols, 'overrideOf'>>, required: true },
    code: { type: String, required: true },
    /** 当前的缩放级别（整数），判断是否到了最小显示级别 */
    level: { type: Number, required: true }
  },
  emits: {
    legend: () => true,
    remove: () => true
  },
  setup(props, { emit }) {
    const resource = computed(() => props.layers.state.value.catalog?.resources.get(props.code));
    const display = computed(() => props.layers.state.value.displays.get(props.code));

    return () => {
      const item = resource.value;
      const shown = display.value;
      if (!item || !shown) {
        return null;
      }
      const { name } = item;
      const statuses = resourceStatuses({
        checked: shown.checked,
        configError: props.layers.configErrors.value.has(props.code),
        tileError: props.layers.tileErrors.value.has(props.code),
        minzoom: props.layers.minzoomOf(props.code),
        zoom: props.level
      });
      const years = item.years.toReversed();
      return [
        <ElTooltip {...MAP_TOOLTIP_PROPS} content="图例" placement="top">
          <button
            type="button"
            class={rowStyles.symbol}
            aria-label={`${name}的图例`}
            data-row-symbol
            onClick={() => emit('legend')}
          >
            <LegendPreview entry={legendEntry(item, shown.year, props.symbols.overrideOf(props.code))} />
          </button>
        </ElTooltip>,
        <span class={rowStyles.name} title={name} data-row-text>
          {name}
        </span>,
        <span class={rowStyles.status}>
          <ResourceStatusIcon statuses={statuses} />
        </span>,
        <span class={rowStyles.fill} />,
        years.length > 1 ? (
          <ElSelect
            class={[rowStyles.trail, 'select-no-arrow', 'select-compact']}
            size="small"
            modelValue={shown.year}
            aria-label={`${name}的年份`}
            onUpdate:modelValue={(year: number) => props.layers.setYear(props.code, year)}
          >
            {years.map(year => (
              <ElOption key={year} label={String(year)} value={year} />
            ))}
          </ElSelect>
        ) : (
          <span class={[rowStyles.trail, rowStyles.trailText]} data-row-text>
            {shown.year}
          </span>
        ),
        <ElTooltip {...MAP_TOOLTIP_PROPS} content="移除" placement="top">
          <button type="button" class={rowStyles.remove} aria-label={`移除：${name}`} onClick={() => emit('remove')}>
            <SvgIcon name="layer-remove" size={16} />
          </button>
        </ElTooltip>
      ];
    };
  }
});
