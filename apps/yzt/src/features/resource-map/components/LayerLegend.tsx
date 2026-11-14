import { computed, defineComponent, type PropType, ref, watch } from 'vue';
import type { ResourceLayers } from '../composables/useResourceLayers';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import { type LegendEntry, legendEntry } from '../legend';
import { INITIAL_LANDUSE_BROWSE, type LanduseBrowse, LanduseLegend } from './LanduseLegend';
import { LegendSettings } from './LegendSettings';
import { ValueLegend } from './ValueLegend';
import styles from './LayerLegend.module.scss';

/** 按类别配色的图例有条目可以浏览；统一符号、统一配色的直接是样式设置 */
export function hasLegendItems(entry: LegendEntry): boolean {
  return entry.kind !== 'symbol' && entry.mode === 'classified';
}

/**
 * 当前图层浮层里一个资源的可编辑图例（ADR 0157）：复用右侧"图例"页的浏览和编辑——地类、按取值的条目列表，
 * 点条目编辑这一类，configuring 时配置整个图层（浮层标题上的样式设置按钮）；统一符号、统一配色的直接是样式设置。
 * 浏览状态（搜索）按资源保管，换一个资源再换回来时照旧；正在编辑的类别换资源时回到浏览
 */
export const LayerLegend = defineComponent({
  name: 'LayerLegend',
  props: {
    layers: { type: Object as PropType<ResourceLayers>, required: true },
    symbols: { type: Object as PropType<ResourceSymbols>, required: true },
    code: { type: String, required: true },
    /** 配置整个图层：浮层标题上的按钮按下 */
    configuring: { type: Boolean, default: false }
  },
  emits: {
    'update:configuring': (configuring: boolean) => typeof configuring === 'boolean'
  },
  setup(props, { emit }) {
    const editing = ref<string | null>(null);
    const selected = ref<ReadonlyMap<string, string>>(new Map());
    const landuseBrowse = ref<ReadonlyMap<string, LanduseBrowse>>(new Map());
    watch(
      () => props.code,
      () => {
        editing.value = null;
      }
    );

    const entry = computed(() => {
      const resource = props.layers.state.value.catalog?.resources.get(props.code);
      const display = props.layers.state.value.displays.get(props.code);
      return resource && display ? legendEntry(resource, display.year, props.symbols.overrideOf(props.code)) : null;
    });

    const back = () => {
      editing.value = null;
      emit('update:configuring', false);
    };

    const renderSettings = (current: LegendEntry, item: string | undefined, canGoBack: boolean) => (
      <LegendSettings
        layers={props.layers}
        symbols={props.symbols}
        entry={current}
        item={item}
        back={canGoBack}
        selected={selected.value.get(current.code)}
        onBack={back}
        onUpdate:selected={(key: string) => (selected.value = new Map([...selected.value, [current.code, key]]))}
      />
    );

    return () => {
      const current = entry.value;
      if (!current) {
        return null;
      }
      if (!hasLegendItems(current)) {
        return <div class={styles.legend}>{renderSettings(current, undefined, false)}</div>;
      }
      if (editing.value !== null) {
        return <div class={styles.legend}>{renderSettings(current, editing.value, true)}</div>;
      }
      if (props.configuring) {
        return <div class={styles.legend}>{renderSettings(current, undefined, true)}</div>;
      }
      return (
        <div class={styles.legend} data-layer-legend={current.code}>
          {current.kind === 'landuse' ? (
            <LanduseLegend
              symbols={props.symbols}
              code={current.code}
              swatches={current.swatches}
              browse={landuseBrowse.value.get(current.code) ?? INITIAL_LANDUSE_BROWSE}
              onUpdate:browse={(browse: LanduseBrowse) =>
                (landuseBrowse.value = new Map([...landuseBrowse.value, [current.code, browse]]))
              }
              onEdit={(item: string) => (editing.value = item)}
            />
          ) : (
            current.kind === 'values' && (
              <ValueLegend
                symbols={props.symbols}
                code={current.code}
                values={current.values}
                onEdit={(item: string) => (editing.value = item)}
              />
            )
          )}
        </div>
      );
    };
  }
});
