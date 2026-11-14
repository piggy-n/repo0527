import { ArrowDown, ArrowRight } from '@element-plus/icons-vue';
import { ElIcon } from 'element-plus';
import { computed, defineComponent, onUnmounted, type PropType, ref, type VNode, watch } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { ResourceLayers } from '../composables/useResourceLayers';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import { type LegendEntry, legendEntries } from '../legend';
import type { SymbolTarget } from '../resource-symbols';
import { INITIAL_LANDUSE_BROWSE, type LanduseBrowse, LanduseLegend } from './LanduseLegend';
import { LegendSettings } from './LegendSettings';
import { LegendSwatchIcon } from './LegendSwatchIcon';
import styles from './ResourceLegend.module.scss';
import { ValueLegend } from './ValueLegend';

// 按属性配色的条目在名称前显示前三个取值的颜色（设计稿 5D.5）
const renderColors = (colors: readonly string[]) => (
  <span class={styles.colors} aria-hidden="true" data-colors>
    {colors.map(color => (
      <i style={{ backgroundColor: color }} />
    ))}
  </span>
);

/**
 * 资源图层的图例（ADR 0043、0044，设计稿 5D.5）：勾选的资源按叠放顺序各一条，内容从样式登记表和符号覆盖推导，
 * 不读地图、不等视图就绪；复合图例默认展开、可以收起成多色块摘要，配置由独立按钮打开（ADR 0066、0094）。
 * 放在功能面板的 Tab 里，标题、开关和登记由外壳负责；隐藏时不渲染条目，编辑器、取色器和弹出层随之卸载，丢弃取色预览；
 * 浏览状态、编辑目标留在这里，再显示时照旧；浏览和编辑共用面板，返回时恢复搜索、展开和滚动位置
 */
export const ResourceLegend = defineComponent({
  name: 'ResourceLegend',
  props: {
    layers: { type: Object as PropType<ResourceLayers>, required: true },
    symbols: { type: Object as PropType<ResourceSymbols>, required: true },
    /** 正在显示；切到别的 Tab、让给另一边时为 false */
    active: { type: Boolean, default: true },
    /**
     * 当前显示的是三维、三维里不显示资源图层（三维引擎的能力 `styleLayers` 为 false；app 注入的是 true，现在走不到，ADR 0157）：
     * 只显示说明，和隐藏时一样卸载条目和编辑器，浏览和编辑目标保留（ADR 0080 第 5 节）；能力为 true 时三维照常显示资源图层，不传
     */
    scene: { type: Boolean, default: false },
    /**
     * 当前图层的图例浮层正在编辑的资源（ADR 0157）：这里正在编辑同一个资源时回到浏览，免得两个符号编辑器对着同一个目标、
     * 一边卸载时清掉另一边正在拖的取色预览
     */
    yieldCode: { type: String as PropType<string | null>, default: null }
  },
  emits: {
    editingChange: (_editing: boolean) => true,
    /** 正在显示的符号编辑器对着的资源（ADR 0157）：页面据此关掉对着同一个资源的图例浮层，后打开编辑的一方为准 */
    editingCode: (code: string | null) => code === null || typeof code === 'string'
  },
  setup(props, { emit }) {
    // 条目的收起是图例自己的界面状态，不持久化：复合图例默认展开，记下用户收起的
    const collapsed = ref<ReadonlySet<string>>(new Set());
    // 资源级配置与图例浏览分开，同时只配置一个资源：没有 item 时配置整个图层，有 item 时直接编辑单个图例
    const editing = ref<SymbolTarget | null>(null);
    // 图例根节点用于查找真实滚动容器
    const element = ref<HTMLElement>();
    // 每个图层设置中选中的分类项，与直接点击条目的编辑目标分开保存
    const selectedItems = ref<ReadonlyMap<string, string>>(new Map());
    // 进入编辑前的列表位置，返回时恢复
    let browseScroll = 0;
    // 条目里的浏览状态，按资源：隐藏时条目卸载，状态留在这里（2026-10-16 评审发现切走再切回时被重置）
    const landuseBrowse = ref<ReadonlyMap<string, LanduseBrowse>>(new Map());
    const setLanduseBrowse = (code: string, browse: LanduseBrowse) => {
      landuseBrowse.value = new Map([...landuseBrowse.value, [code, browse]]);
    };
    const entries = computed(() =>
      legendEntries(props.layers.state.value, props.layers.configErrors.value, props.symbols.overrideOf)
    );
    const editingEntry = computed(() => entries.value.find(entry => entry.code === editing.value?.code));

    // 使用实际滚动祖先，不依赖外壳的类名或 DOM 层数
    const scrollContainer = () => {
      let parent = element.value?.parentElement;
      while (parent && !['auto', 'scroll'].includes(getComputedStyle(parent).overflowY)) {
        parent = parent.parentElement;
      }
      return parent;
    };
    const openEditor = (target: SymbolTarget) => {
      browseScroll = scrollContainer()?.scrollTop ?? 0;
      editing.value = target;
    };
    const returnToLegend = () => {
      editing.value = null;
    };
    watch(
      editing,
      target => {
        const scroller = scrollContainer();
        if (scroller && props.active) {
          scroller.scrollTop = target ? 0 : browseScroll;
        }
      },
      { flush: 'post' }
    );
    // 资源取消勾选或配置失效后，不保留已经失去目标的编辑器
    watch(editingEntry, entry => {
      if (!entry) {
        editing.value = null;
      }
    });
    watch(
      () => props.yieldCode,
      code => {
        if (code !== null && editing.value?.code === code) {
          editing.value = null;
        }
      },
      { immediate: true }
    );
    // 外壳只在浏览视图提供全局恢复入口，关闭图例时清除外壳的编辑状态
    watch(
      () => editingEntry.value !== undefined,
      value => emit('editingChange', value),
      { immediate: true }
    );
    watch(
      () => (props.active && !props.scene && editingEntry.value ? editingEntry.value.code : null),
      code => emit('editingCode', code),
      { immediate: true }
    );
    onUnmounted(() => {
      emit('editingChange', false);
      emit('editingCode', null);
    });

    const toggle = (code: string) => {
      const next = new Set(collapsed.value);
      if (!next.delete(code)) {
        next.add(code);
      }
      collapsed.value = next;
    };

    // 展开只显示图例，样式方式和恢复默认由资源级配置入口单独显示
    const renderClassified = (entry: Exclude<LegendEntry, { kind: 'symbol' }>): VNode => {
      if (entry.kind === 'landuse') {
        return (
          <LanduseLegend
            symbols={props.symbols}
            code={entry.code}
            swatches={entry.swatches}
            browse={landuseBrowse.value.get(entry.code) ?? INITIAL_LANDUSE_BROWSE}
            onUpdate:browse={(browse: LanduseBrowse) => setLanduseBrowse(entry.code, browse)}
            onEdit={(item: string) => openEditor({ code: entry.code, item })}
          />
        );
      }
      return (
        <ValueLegend
          symbols={props.symbols}
          code={entry.code}
          values={entry.values}
          onEdit={(item: string) => openEditor({ code: entry.code, item })}
        />
      );
    };

    const renderConfiguration = (entry: LegendEntry) => (
      <LegendSettings
        layers={props.layers}
        symbols={props.symbols}
        entry={entry}
        item={editing.value?.item}
        selected={selectedItems.value.get(entry.code)}
        onBack={returnToLegend}
        onUpdate:selected={(key: string) => {
          selectedItems.value = new Map([...selectedItems.value, [entry.code, key]]);
        }}
      />
    );

    // 复合图例收起时显示多色块摘要；单一符号直接展示，配置按钮不承担展开图例的动作
    const renderEntry = (entry: LegendEntry): VNode => {
      const isOpen = !collapsed.value.has(entry.code);
      const uniform = entry.kind === 'symbol' || entry.mode === 'uniform';
      const summary = (
        <>
          <span class={styles.arrow} aria-hidden="true">
            {!uniform && <ElIcon>{isOpen ? <ArrowDown /> : <ArrowRight />}</ElIcon>}
          </span>
          <span class={styles.preview}>
            {uniform ? <LegendSwatchIcon swatch={entry.swatch} /> : renderColors(entry.colors)}
          </span>
          <span class={styles.name} title={entry.name}>{entry.name}</span>
          <span class={styles.year}>{entry.year}</span>
          <span class={styles.editedSlot}>
            {props.symbols.isCustomized(entry.code) && <span class={styles.edited} title="改过符号" data-edited />}
          </span>
        </>
      );
      return (
        <li
          key={entry.code}
          class={styles.entry}
          style={{ '--legend-opacity': props.layers.state.value.displays.get(entry.code)?.opacity }}
          data-legend={entry.code}
        >
          <div class={styles.row}>
            {uniform ? (
              <button
                type="button"
                class={[styles.summary, styles.uniformSummary]}
                aria-label={`编辑${entry.name}图例`}
                onClick={() => openEditor({ code: entry.code })}
              >
                {summary}
              </button>
            ) : (
              <button
                type="button"
                class={styles.summary}
                aria-label={`${isOpen ? '收起' : '展开'}${entry.name}`}
                aria-expanded={isOpen}
                onClick={() => toggle(entry.code)}
              >
                {summary}
              </button>
            )}
            {!uniform && (
              <button
                type="button"
                class={styles.configure}
                aria-label={`编辑${entry.name}样式`}
                title="样式设置"
                onClick={() => openEditor({ code: entry.code })}
              >
                <SvgIcon name="symbol-settings" size={16} />
              </button>
            )}
          </div>
          {isOpen && !uniform && (
            <div class={styles.content}>{renderClassified(entry)}</div>
          )}
        </li>
      );
    };

    const renderBody = () => {
      if (editingEntry.value) {
        return renderConfiguration(editingEntry.value);
      }
      if (entries.value.length === 0) {
        return <div class={styles.empty}>勾选资源后查看图例</div>;
      }
      return <ul class={styles.entries}>{entries.value.map(renderEntry)}</ul>;
    };

    return () =>
      props.active ? (
        <div ref={element} class={styles.legend} data-resource-legend>
          {props.scene ? (
            <p class={styles.sceneNote} data-legend-scene-note>
              三维模式暂不显示资源图层，图例在切回二维后可用。
            </p>
          ) : (
            renderBody()
          )}
        </div>
      ) : null;
  }
});
