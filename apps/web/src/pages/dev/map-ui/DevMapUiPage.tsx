import { provideMap } from '@yzt/map-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import { ElButton, ElRadioButton, ElRadioGroup } from 'element-plus';
import { computed, defineComponent, ref, shallowRef } from 'vue';
import { RouterLink } from 'vue-router';
import { ResourceLayerPanel } from '@/features/resource-map/components/ResourceLayerPanel';
import { ResourceLegend } from '@/features/resource-map/components/ResourceLegend';
import { ResourceLegendReset } from '@/features/resource-map/components/ResourceLegendReset';
import { useCatalogOrder } from '@/features/resource-map/composables/useCatalogOrder';
import { useResourceLayers } from '@/features/resource-map/composables/useResourceLayers';
import { useResourcePanelLayout } from '@/features/resource-map/composables/useResourcePanelLayout';
import { useResourceSymbols } from '@/features/resource-map/composables/useResourceSymbols';
import { BasemapPanel } from '@/shared/map/basemap/BasemapPanel';
import { basemapOption } from '@/shared/map/basemap/basemap-style';
import { BasemapThumbnail } from '@/shared/map/basemap/BasemapThumbnail';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { BoundarySettingsPanel } from '@/shared/map/boundary/BoundarySettingsPanel';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { MapCard } from '@/shared/map/card/MapCard';
import { MapPanelGroup, type PanelSlotProps } from '@/shared/map/panel-group/MapPanelGroup';
import { usePanelGroup } from '@/shared/map/panel-group/usePanelGroup';
import { MapOptionsPopover } from '@/shared/map/popover/MapOptionsPopover';
import { MapToolbar } from '@/shared/map/toolbar/MapToolbar';
import { RouteName } from '@/shared/router/route-names';
import styles from './DevMapUiPage.module.scss';
import { SAMPLE_CATALOG, SAMPLE_THUMBNAILS } from './samples';

// 示例只装配现有组件；不挂载地图引擎、不绑定瓦片、不传入偏好范围
const MapUiSamples = defineComponent({
  name: 'MapUiSamples',
  props: {
    width: { type: Number, required: true },
    height: { type: Number, required: true }
  },
  setup(props) {
    const map = provideMap({ groups: ['resources'], camera: { center: [119.4, 32.9], zoom: 16, bearing: 0, pitch: 0 } });
    const catalog = shallowRef(SAMPLE_CATALOG);
    const symbols = useResourceSymbols({ catalog });
    const layers = useResourceLayers(map, { catalog, symbols });
    const order = useCatalogOrder();
    const layout = useResourcePanelLayout();
    const boundaries = useBoundaries();
    const basemap = { ...useBasemap(), thumbnails: SAMPLE_THUMBNAILS };
    const panels = usePanelGroup(['legend', 'boundaries'] as const);
    const collapsed = ref(false);
    const editing = ref(false);
    const basemapOpen = ref(false);
    // 切换样例只改勾选，年份与样式继续由真实拥有者维护
    const codes = [...SAMPLE_CATALOG.resources.keys()];
    const selectCount = (count: number) => {
      layers.setCheckedMany(codes, false);
      layers.setCheckedMany(codes.slice(0, count), true);
    };
    const open = (id: 'legend' | 'boundaries') => {
      panels.toggle(id, !collapsed.value);
      collapsed.value = false;
    };
    // 展示真实状态，尤其用于比较批量年份和单个资源年份
    const displays = computed(() => layers.state.value.order.map(code => ({
      code,
      name: SAMPLE_CATALOG.resources.get(code)?.name ?? code,
      display: layers.state.value.displays.get(code)
    })));
    selectCount(codes.length);
    panels.show('legend');

    return () => (
      <div style={{ '--sample-width': `${props.width}px`, '--sample-height': `${props.height}px` }}>
        <div class={styles.controls}>
          <span>勾选场景</span>
          <ElButton size="small" onClick={() => selectCount(0)}>无资源</ElButton>
          <ElButton size="small" onClick={() => selectCount(1)}>单个资源</ElButton>
          <ElButton size="small" onClick={() => selectCount(codes.length)}>多个资源</ElButton>
        </div>
        <div class={styles.grid}>
          <section class={styles.sample}>
            <MxTitle level="panel">资源列表</MxTitle>
            <p class={styles.note}>勾选、搜索、年份、排序和透明度均可操作。已勾选默认收起。</p>
            <div class={styles.stage}>
              <div class={styles.resourceColumn}>
                <ResourceLayerPanel
                  layers={layers}
                  catalogOrder={order}
                  layout={layout}
                  collapsed={layout.collapsed.value}
                  onUpdate:collapsed={layout.setCollapsed}
                />
              </div>
            </div>
          </section>
          <section class={styles.sample}>
            <MxTitle level="panel">图例与功能面板</MxTitle>
            <p class={styles.note}>点击右侧图标，比较单功能标题与多功能标签；图例与左侧资源同步。</p>
            <div class={styles.stage}>
              <div class={styles.toolsRow}>
                <div class={styles.panelColumn}>
                  <MapPanelGroup
                    group={panels}
                    labels={{ legend: '图例', boundaries: '行政区' }}
                    collapsed={collapsed.value}
                    collapsible
                    onUpdate:collapsed={value => (collapsed.value = value)}>
                    {{
                      legend: ({ active }: PanelSlotProps) => [
                        <ResourceLegend
                          layers={layers}
                          symbols={symbols}
                          active={active}
                          onEditingChange={value => (editing.value = value)}
                        />
                      ],
                      'legend-footer': () => !editing.value && symbols.overrides.value.size > 0
                        ? [<ResourceLegendReset symbols={symbols} />]
                        : [],
                      boundaries: ({ active }: PanelSlotProps) => [
                        <BoundarySettingsPanel boundaries={boundaries} active={active} />
                      ]
                    }}
                  </MapPanelGroup>
                </div>
                <MapToolbar
                  compact
                  groups={[['boundaries', 'legend']]}
                  actions={{ boundaries: () => open('boundaries'), legend: () => open('legend') }}
                  opened={panels.state.value.open}
                  pressed={!collapsed.value && panels.state.value.current ? [panels.state.value.current] : []}
                />
              </div>
            </div>
          </section>
          <section class={styles.sample}>
            <MxTitle level="panel">标题与底图浮层</MxTitle>
            <p class={styles.note}>标题直接使用公共组件；底图使用本地示意缩略图，交互与业务页相同。</p>
            <div class={[styles.stage, styles.examples]}>
              <div class={styles.panelColumn}>
                <MxPanel title="通用面板标题" headerTone="muted" class={styles.titlePanel}>
                  <MxTitle>区块标题</MxTitle>
                  <p class={styles.note}>主标题 16 / 600，区块标题 14 / 600，辅助信息 12。</p>
                  <span class={styles.note}>浅灰标题栏使用公共 headerTone="muted" 变体，内部区块保留容器底色。</span>
                </MxPanel>
              </div>
              <div class={styles.basemapArea}>
                <span class={styles.note}>点击缩略图打开；再次点击或 × 关闭</span>
                <div class={styles.basemapTrigger}>
                  <MapOptionsPopover
                    name="sample-basemap"
                    label="底图"
                    opacity={basemap.opacity.value}
                    open={basemapOpen.value}
                    onUpdate:open={value => (basemapOpen.value = value)}
                    onOpacityChange={basemap.setOpacity}>
                    {{
                      reference: () => [
                        <MapCard
                          label={basemapOption(basemap.selected.value).shortLabel}
                          name={`底图：${basemapOption(basemap.selected.value).label}`}
                          pressed={basemapOpen.value}>
                          {{ cover: () => [<BasemapThumbnail thumbnail={basemap.thumbnails[basemap.selected.value]} />] }}
                        </MapCard>
                      ],
                      default: () => [<BasemapPanel basemap={basemap} showOpacity={false} />]
                    }}
                  </MapOptionsPopover>
                </div>
              </div>
              <p class={styles.note}>
                当前底图：{basemapOption(basemap.selected.value).shortLabel}
                {basemap.opacity.value !== null && ` · 透明度 ${Math.round(basemap.opacity.value * 100)}%`}
              </p>
            </div>
          </section>
        </div>
        <section class={styles.state}>
          <MxTitle level="panel">年份与图层状态</MxTitle>
          <p class={styles.note}>
            批量年份是一次操作，执行后选择框回到占位文字；没有目标年份的资源保持原值。
            可先批量选 2023，再单独改一层，最后重复批量选 2023，观察下表与图例。
          </p>
          <table class={styles.stateTable}>
            <thead><tr><th>资源</th><th>勾选</th><th>当前年份</th><th>透明度</th></tr></thead>
            <tbody>
              {displays.value.map(({ code, name, display }) => (
                <tr key={code} data-sample-state={code}>
                  <td>{name}</td>
                  <td>{display?.checked ? '已勾选' : '未勾选'}</td>
                  <td>{display?.year}</td>
                  <td>{display && `${Math.round(display.opacity * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    );
  }
});

/** 已验收地图界面的交互样例；仅开发路由可访问，供后续迁移复用 */
export const DevMapUiPage = defineComponent({
  name: 'DevMapUiPage',
  setup() {
    const width = ref(320);
    const height = ref(520);
    // 重建样例清空临时状态，避免复制各拥有者的重置规则
    const revision = ref(0);
    return () => (
      <main class={styles.page}>
        <header class={styles.intro}>
          <div>
            <h1>现状底图 · 交互样例</h1>
            <p>复用真实组件与项目主题。固定数据，不保存偏好；地图渲染、定位与查询请在业务页面验收。</p>
          </div>
          <nav class={styles.links}>
            <RouterLink to={{ name: RouteName.devTheme }}>主题规范</RouterLink>
            <RouterLink to={{ name: RouteName.currentMap }}>现状底图</RouterLink>
          </nav>
        </header>
        <div class={styles.controls}>
          <span>面板宽度</span>
          <ElRadioGroup
            modelValue={width.value}
            onUpdate:modelValue={value => (width.value = Number(value))}
            size="small"
          >
            {[320, 280, 240].map(value => (
              <ElRadioButton key={value} value={value}>
                {value}px
              </ElRadioButton>
            ))}
          </ElRadioGroup>
          <span>可用高度</span>
          <ElRadioGroup
            modelValue={height.value}
            onUpdate:modelValue={value => (height.value = Number(value))}
            size="small"
          >
            {[520, 360].map(value => (
              <ElRadioButton key={value} value={value}>
                {value}px
              </ElRadioButton>
            ))}
          </ElRadioGroup>
          <ElButton size="small" onClick={() => revision.value++}>
            还原样例
          </ElButton>
        </div>
        <MapUiSamples key={revision.value} width={width.value} height={height.value} />
      </main>
    );
  }
});
