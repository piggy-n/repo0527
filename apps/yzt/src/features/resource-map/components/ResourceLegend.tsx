import { ArrowDown, ArrowRight } from '@element-plus/icons-vue';
import { ElIcon } from 'element-plus';
import { computed, defineComponent, onUnmounted, type PropType, ref, type VNode, watch } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { ResourceLayers } from '../composables/useResourceLayers';
import type { ResourceSymbols } from '../composables/useResourceSymbols';
import { type LegendEntry, legendEntries } from '../legend';
import { INITIAL_LANDUSE_BROWSE, type LanduseBrowse, LanduseLegend } from './LanduseLegend';
import { LegendPreview } from './LegendPreview';
import { LegendSettings } from './LegendSettings';
import styles from './ResourceLegend.module.scss';
import { ValueLegend } from './ValueLegend';

/**
 * 资源图层的图例（ADR 0043、0044、0175，设计稿 5D.5）：勾选的资源按叠放顺序各一条，内容从样式登记表和符号覆盖推导，
 * 不读地图、不等视图就绪。图例以看为主（用户 2026-11-24）：每一行是箭头、摘要（ADR 0159）、名称、年份，按类别配色的
 * 单击展开、收起（默认展开，ADR 0094），单一符号、统一配色的单击不做什么；修改从行尾的"样式设置"进，三种图例一样，
 * 点子图例的一类进这一类的样式设置。按分类过滤着的资源（ADR 0173）照样列出全部类别，过滤掉的淡显（用户 2026-11-24）。
 * 放在功能面板的 Tab 里，标题、开关和登记由外壳负责；隐藏时不渲染条目，编辑器、取色器和弹出层随之卸载，丢弃取色预览；
 * 浏览状态、编辑目标留在这里，再显示时照旧；浏览和编辑共用面板，返回时恢复搜索、展开和滚动位置，焦点回到这一行
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
     * 当前图层的图例浮层正在样式设置里的资源（ADR 0157）：这里正在设置同一个资源时回到浏览，免得两个符号编辑器对着同一个
     * 目标、一边卸载时清掉另一边正在拖的取色预览
     */
    yieldCode: { type: String as PropType<string | null>, default: null }
  },
  emits: {
    editingChange: (_editing: boolean) => true,
    /** 正在显示的符号编辑器对着的资源（ADR 0157）：页面据此让图例浮层回到浏览，后打开设置的一方为准 */
    editingCode: (code: string | null) => code === null || typeof code === 'string'
  },
  setup(props, { emit }) {
    // 条目的收起是图例自己的界面状态，不持久化：复合图例默认展开，记下用户收起的
    const collapsed = ref<ReadonlySet<string>>(new Set());
    // 正在样式设置里的资源，同时只设置一个
    const editing = ref<string | null>(null);
    // 图例根节点用于查找真实滚动容器
    const element = ref<HTMLElement>();
    // 按类别配色时样式设置里选中的类别，按资源记：点了子图例的一类时就是它
    const selectedItems = ref<ReadonlyMap<string, string>>(new Map());
    // 进入设置前的列表位置，返回时恢复
    let browseScroll = 0;
    // 条目里的浏览状态，按资源：隐藏时条目卸载，状态留在这里（2026-10-16 评审发现切走再切回时被重置）
    const landuseBrowse = ref<ReadonlyMap<string, LanduseBrowse>>(new Map());
    const setLanduseBrowse = (code: string, browse: LanduseBrowse) => {
      landuseBrowse.value = new Map([...landuseBrowse.value, [code, browse]]);
    };
    const entries = computed(() =>
      legendEntries(props.layers.state.value, props.layers.configErrors.value, props.symbols.overrideOf)
    );
    const editingEntry = computed(() => entries.value.find(entry => entry.code === editing.value));

    // 使用实际滚动祖先，不依赖外壳的类名或 DOM 层数
    const scrollContainer = () => {
      let parent = element.value?.parentElement;
      while (parent && !['auto', 'scroll'].includes(getComputedStyle(parent).overflowY)) {
        parent = parent.parentElement;
      }
      return parent;
    };
    const openSettings = (code: string, item?: string) => {
      if (item !== undefined) {
        selectedItems.value = new Map([...selectedItems.value, [code, item]]);
      }
      browseScroll = scrollContainer()?.scrollTop ?? 0;
      editing.value = code;
    };
    const returnToLegend = () => {
      editing.value = null;
    };
    // 进设置：滚到顶、焦点到标题行（读屏报出换了视图）；返回：恢复滚动、焦点回到这一行的样式设置。
    // 焦点只在原本就在图例里（或随旧视图卸载掉到了 body）时移动，因为别处（图层浮层）让出来的不抢焦点
    watch(
      editing,
      (code, previous) => {
        const root = element.value;
        const scroller = scrollContainer();
        if (!root || !props.active) {
          return;
        }
        if (scroller) {
          scroller.scrollTop = code ? 0 : browseScroll;
        }
        const active = document.activeElement;
        if (active !== null && active !== document.body && !root.contains(active)) {
          return;
        }
        const target = code
          ? root.querySelector<HTMLElement>('[data-settings-heading]')
          : root.querySelector<HTMLElement>(`[data-legend="${CSS.escape(previous ?? '')}"] [data-legend-settings-button]`);
        target?.focus({ preventScroll: true });
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
        if (code !== null && editing.value === code) {
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

    // 展开的子图例：点一类进这一类的样式设置（用户 2026-11-24）
    const renderClassified = (entry: Exclude<LegendEntry, { kind: 'symbol' }>): VNode => {
      if (entry.kind === 'landuse') {
        return (
          <LanduseLegend
            code={entry.code}
            swatches={entry.swatches}
            excluded={entry.excluded}
            browse={landuseBrowse.value.get(entry.code) ?? INITIAL_LANDUSE_BROWSE}
            onUpdate:browse={(browse: LanduseBrowse) => setLanduseBrowse(entry.code, browse)}
            onEdit={(item: string) => openSettings(entry.code, item)}
          />
        );
      }
      return <ValueLegend code={entry.code} values={entry.values} onEdit={(item: string) => openSettings(entry.code, item)} />;
    };

    const renderSettings = (entry: LegendEntry) => (
      <LegendSettings
        layers={props.layers}
        symbols={props.symbols}
        entry={entry}
        selected={selectedItems.value.get(entry.code)}
        onBack={returnToLegend}
        onUpdate:selected={(key: string) => {
          selectedItems.value = new Map([...selectedItems.value, [entry.code, key]]);
        }}
      />
    );

    // 一行：箭头、摘要、名称、年份，行尾是样式设置；按类别配色的整行是展开、收起的按钮，单一符号、统一配色的不是按钮
    const renderEntry = (entry: LegendEntry): VNode => {
      const classified = entry.kind !== 'symbol' && entry.mode === 'classified';
      const isOpen = classified && !collapsed.value.has(entry.code);
      const summary = (
        <>
          <span class={styles.arrow} aria-hidden="true">
            {classified && <ElIcon>{isOpen ? <ArrowDown /> : <ArrowRight />}</ElIcon>}
          </span>
          <span class={styles.preview}>
            <LegendPreview entry={entry} />
          </span>
          <span class={styles.name} title={entry.name}>
            {entry.name}
          </span>
          <span class={styles.year}>{entry.year}</span>
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
            {classified ? (
              <button
                type="button"
                class={styles.summary}
                aria-expanded={isOpen}
                onClick={() => toggle(entry.code)}
              >
                {summary}
              </button>
            ) : (
              <div class={styles.summary}>{summary}</div>
            )}
            <button
              type="button"
              class={styles.configure}
              aria-label={`${entry.name}的样式设置`}
              title="样式设置"
              data-legend-settings-button
              onClick={() => openSettings(entry.code)}
            >
              <SvgIcon name="symbol-settings" size={16} />
            </button>
          </div>
          {isOpen && <div class={styles.content}>{renderClassified(entry)}</div>}
        </li>
      );
    };

    const renderBody = () => {
      if (editingEntry.value) {
        return renderSettings(editingEntry.value);
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
