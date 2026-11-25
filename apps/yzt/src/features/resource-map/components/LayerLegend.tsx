import { computed, defineComponent, type PropType, ref } from 'vue';
import type { ResourceLayers } from '../composables/useResourceLayers';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import { type LegendEntry, legendEntry } from '../legend';
import { INITIAL_LANDUSE_BROWSE, type LanduseBrowse, LanduseLegend } from './LanduseLegend';
import { LegendSettings } from './LegendSettings';
import { ValueLegend } from './ValueLegend';
import styles from './LayerLegend.module.scss';

/**
 * 按类别配色的图例有子图例可以看；单一符号、统一配色的没有，图层浮层一打开就是样式设置（用户 2026-11-24）
 */
export function hasLegendItems(entry: LegendEntry): boolean {
  return entry.kind !== 'symbol' && entry.mode === 'classified';
}

/**
 * 当前图层浮层里一个资源的图例（ADR 0157、0175）：configuring（浮层标题上的样式设置按下）时是样式设置，和右侧"图例"页的
 * 同一个视图，只是没有标题和"返回图例"那一行（再点标题栏的样式设置回到图例，用户 2026-11-25）；否则是图例本身——按类别配色的子图例，点一类进这一类的样式设置；单一符号、统一配色没有内容（符号在标题栏）。
 * 浏览状态（搜索）、样式设置里选中的类别按资源保管，换一个资源再换回来时照旧。
 * 按分类过滤着时（ADR 0173）照样列出全部类别，过滤掉的淡显
 */
export const LayerLegend = defineComponent({
  name: 'LayerLegend',
  props: {
    layers: { type: Object as PropType<ResourceLayers>, required: true },
    symbols: { type: Object as PropType<ResourceSymbols>, required: true },
    code: { type: String, required: true },
    /** 样式设置：浮层标题上的按钮按下 */
    configuring: { type: Boolean, default: false }
  },
  emits: {
    /** 点子图例的一类进样式设置时报 true；回到图例由标题栏的样式设置负责 */
    'update:configuring': (configuring: boolean) => typeof configuring === 'boolean'
  },
  setup(props, { emit }) {
    const selected = ref<ReadonlyMap<string, string>>(new Map());
    const landuseBrowse = ref<ReadonlyMap<string, LanduseBrowse>>(new Map());
    const select = (code: string, item: string) => {
      selected.value = new Map([...selected.value, [code, item]]);
    };

    const entry = computed(() => {
      const resource = props.layers.state.value.catalog?.resources.get(props.code);
      const display = props.layers.state.value.displays.get(props.code);
      return resource && display
        ? legendEntry(resource, display.year, props.symbols.overrideOf(props.code), display.filter)
        : null;
    });

    // 点子图例的一类：选中它，进样式设置
    const edit = (code: string, item: string) => {
      select(code, item);
      emit('update:configuring', true);
    };

    const renderItems = (current: Exclude<LegendEntry, { kind: 'symbol' }>) =>
      current.kind === 'landuse' ? (
        <LanduseLegend
          code={current.code}
          swatches={current.swatches}
          excluded={current.excluded}
          browse={landuseBrowse.value.get(current.code) ?? INITIAL_LANDUSE_BROWSE}
          onUpdate:browse={(browse: LanduseBrowse) =>
            (landuseBrowse.value = new Map([...landuseBrowse.value, [current.code, browse]]))
          }
          onEdit={(item: string) => edit(current.code, item)}
        />
      ) : (
        <ValueLegend code={current.code} values={current.values} onEdit={(item: string) => edit(current.code, item)} />
      );

    return () => {
      const current = entry.value;
      if (!current) {
        return null;
      }
      if (props.configuring) {
        return (
          <div class={styles.legend}>
            <LegendSettings
              layers={props.layers}
              symbols={props.symbols}
              entry={current}
              heading={false}
              selected={selected.value.get(current.code)}
              onUpdate:selected={(key: string) => select(current.code, key)}
            />
          </div>
        );
      }
      // 单一符号、统一配色没有子图例，符号已经在标题栏：不在样式设置里时没有内容，浮层只剩标题栏（用户 2026-11-24）
      if (current.kind === 'symbol' || current.mode === 'uniform') {
        return null;
      }
      return (
        <div class={styles.legend} data-layer-legend={current.code}>
          {renderItems(current)}
        </div>
      );
    };
  }
});
