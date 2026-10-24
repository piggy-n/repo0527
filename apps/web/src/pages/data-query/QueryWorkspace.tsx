import { Expand } from '@element-plus/icons-vue';
import { MapCanvas, useMapOverlay } from '@yzt/map-vue';
import { MxPanel } from '@yzt/ui';
import { useMediaQuery } from '@vueuse/core';
import { ElButton, ElDrawer, ElEmpty } from 'element-plus';
import { computed, defineComponent, type PropType, ref, watch } from 'vue';
import { QueryConditions } from '@/features/data-query/components/QueryConditions';
import { QueryDetail } from '@/features/data-query/components/QueryDetail';
import { QueryResults } from '@/features/data-query/components/QueryResults';
import { MODULE_LABELS } from '@/features/data-query/config';
import type { DataQuery } from '@/features/data-query/composables/useDataQuery';
import type { useQueryDetail } from '@/features/data-query/composables/useQueryDetail';
import type { QueryDrawing } from '@/features/data-query/composables/useQueryDrawing';
import type { QueryModule } from '@/features/data-query/types';
import { BasemapPanel } from '@/shared/map/basemap/BasemapPanel';
import { basemapOption } from '@/shared/map/basemap/basemap-style';
import { BasemapThumbnail } from '@/shared/map/basemap/BasemapThumbnail';
import type { useBasemap } from '@/shared/map/basemap/useBasemap';
import { BoundarySettingsPanel } from '@/shared/map/boundary/BoundarySettingsPanel';
import type { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { MapCard } from '@/shared/map/card/MapCard';
import { JIANGSU_ZOOM_RANGE } from '@/shared/map/jiangsu';
import { CoordinateLocatePanel } from '@/shared/map/location/CoordinateLocatePanel';
import { LocationOverlay } from '@/shared/map/location/LocationOverlay';
import type { useLocationPoint } from '@/shared/map/location/useLocationPoint';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import { MeasureOverlay } from '@/shared/map/measure/MeasureOverlay';
import type { useMeasure } from '@/shared/map/measure/useMeasure';
import { MapPanelGroup, type PanelSlotProps } from '@/shared/map/panel-group/MapPanelGroup';
import { usePanelGroup } from '@/shared/map/panel-group/usePanelGroup';
import { MapOptionsPopover } from '@/shared/map/popover/MapOptionsPopover';
import { RegionLocatePanel } from '@/shared/map/region/RegionLocatePanel';
import type { useRegionLocate } from '@/shared/map/region/useRegionLocate';
import { MapToolbar } from '@/shared/map/toolbar/MapToolbar';
import { MapViewControls } from '@/shared/map/view-controls/MapViewControls';
import styles from './data-query.module.scss';

interface QueryMapTools {
  basemap: ReturnType<typeof useBasemap>;
  boundaries: ReturnType<typeof useBoundaries>;
  region: ReturnType<typeof useRegionLocate>;
  location: ReturnType<typeof useLocationPoint>;
  measure: ReturnType<typeof useMeasure>;
  goToDefaultView: () => void;
}

const FUNCTIONS = ['boundaries', 'region-locate', 'coordinate-locate'] as const;
const LABELS = { boundaries: '行政区', 'region-locate': '区划定位', 'coordinate-locate': '坐标定位' };
const GROUPS = [
  ['browse'], ['measure-distance', 'measure-area'], ['region-locate', 'coordinate-locate'], ['boundaries'], ['clear']
] as const;

/** 只组合条件、结果和公共地图工具，悬浮尺寸交给地图避让计算 */
export const QueryWorkspace = defineComponent({
  name: 'QueryWorkspace',
  props: {
    module: { type: String as PropType<QueryModule>, required: true },
    model: { type: Object as PropType<DataQuery>, required: true },
    drawing: { type: Object as PropType<QueryDrawing>, required: true },
    detail: { type: Object as PropType<ReturnType<typeof useQueryDetail>>, required: true },
    tools: { type: Object as PropType<QueryMapTools>, required: true }
  },
  setup(props) {
    const conditionPanel = ref<HTMLElement>();
    const resultPanel = ref<HTMLElement>();
    const detailPanel = ref<HTMLElement>();
    const compact = useMediaQuery('(width < 1200px), (height < 700px)');
    const functions = usePanelGroup(FUNCTIONS);
    const basemapOpen = ref(false);
    const collapsed = ref(false);
    const current = computed(() => basemapOption(props.tools.basemap.selected.value));
    useMapOverlay(conditionPanel, 'left');
    useMapOverlay(resultPanel, 'bottom');
    useMapOverlay(detailPanel, 'right');
    watch(compact, () => (props.model.formOpen.value = !compact.value), { immediate: true });
    // 详情与工具共用右侧位置，打开一方时收起另一方，避免叠压内容
    watch(props.model.selected, row => {
      if (row) {
        functions.closeAll();
      }
    });
    const toggle = (id: typeof FUNCTIONS[number]) => {
      props.model.selected.value = null;
      collapsed.value = false;
      functions.toggle(id, true);
    };
    const actions = {
      boundaries: () => toggle('boundaries'),
      'region-locate': () => toggle('region-locate'),
      'coordinate-locate': () => toggle('coordinate-locate'),
      clear: () => {
        props.tools.measure.clear();
        props.tools.location.remove();
        props.drawing.clear();
      }
    };

    return () => {
      const { model, drawing, detail, tools } = props;
      const available = model.layers.value.length > 0;
      return (
        <div class={styles.workspace}>
          <MapCanvas mapOptions={JIANGSU_ZOOM_RANGE} />
          <MapStatusNotice />
          <MeasureOverlay measure={tools.measure} />
          <LocationOverlay location={tools.location} />
          <div class={[styles.overlays, model.resultOpen.value && styles.withResults]}>
            <div class={styles.topArea}>
              {available ? (
                compact.value ? (
                  <ElButton class={styles.queryEntry} icon={Expand} onClick={() => (model.formOpen.value = true)}>
                    查询条件
                  </ElButton>
                ) : (
                  <div ref={conditionPanel} class={styles.conditionPanel}>
                    <QueryConditions model={model} drawing={drawing} />
                  </div>
                )
              ) : (
                <div class={styles.conditionPanel}>
                  <MxPanel title={MODULE_LABELS[props.module]} headerTone="muted" floating>
                    <ElEmpty description="查询功能待建设" imageSize={64} />
                  </MxPanel>
                </div>
              )}
              <div ref={detailPanel} class={styles.rightPanel}>
                {model.selected.value && <QueryDetail model={model} detail={detail} />}
                <MapPanelGroup
                  group={functions}
                  labels={LABELS}
                  collapsible
                  collapsed={collapsed.value}
                  onUpdate:collapsed={value => (collapsed.value = value)}
                >
                  {{
                    boundaries: ({ active }: PanelSlotProps) => [
                      <BoundarySettingsPanel boundaries={tools.boundaries} active={active} />
                    ],
                    'region-locate': () => [<RegionLocatePanel region={tools.region} />],
                    'coordinate-locate': ({ active }: PanelSlotProps) => [
                      <CoordinateLocatePanel location={tools.location} active={active} />
                    ]
                  }}
                </MapPanelGroup>
              </div>
              <div class={styles.mapTools}>
                <MapToolbar
                  groups={GROUPS}
                  actions={actions}
                  pressed={collapsed.value || !functions.state.value.current ? [] : [functions.state.value.current]}
                  opened={functions.state.value.open}
                  compact
                />
                <div class={styles.mapControls}>
                  <MapViewControls goToDefaultView={tools.goToDefaultView} zoomRange={JIANGSU_ZOOM_RANGE} />
                  <MapOptionsPopover
                    name="basemap"
                    label="底图"
                    opacity={tools.basemap.opacity.value}
                    open={basemapOpen.value}
                    onOpacityChange={tools.basemap.setOpacity}
                    onUpdate:open={value => (basemapOpen.value = value)}
                  >
                    {{
                      reference: () => [
                        <MapCard
                          label={current.value.shortLabel}
                          name={`底图：${current.value.label}`}
                          pressed={basemapOpen.value}
                        >
                          {{ cover: () => [
                            <BasemapThumbnail thumbnail={tools.basemap.thumbnails[current.value.id]} />
                          ] }}
                        </MapCard>
                      ],
                      default: () => [<BasemapPanel basemap={tools.basemap} showOpacity={false} />]
                    }}
                  </MapOptionsPopover>
                </div>
              </div>
              {drawing.active.value && (
                <div class={styles.drawingHint} role="status">
                  {model.method.value === 'rectangle' ? '拖动框选，Esc 取消' : '单击绘制，双击或回车完成，Esc 取消'}
                </div>
              )}
            </div>
            {available && (
              <div ref={resultPanel} class={[styles.results, model.maximized.value && styles.maximized]}>
                <QueryResults model={model} />
              </div>
            )}
          </div>
          {compact.value && available && (
            <ElDrawer
              direction="ltr"
              size="min(320px, 100vw)"
              withHeader={false}
              bodyClass={styles.drawerBody}
              title="查询条件"
              modelValue={model.formOpen.value}
              onUpdate:modelValue={value => (model.formOpen.value = value)}
            >
              <QueryConditions model={model} drawing={drawing} compact />
            </ElDrawer>
          )}
        </div>
      );
    };
  }
});
