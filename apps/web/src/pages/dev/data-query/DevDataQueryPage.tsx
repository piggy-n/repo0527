import { Close, Expand } from '@element-plus/icons-vue';
import { MapCanvas, provideMap, useMap, useMapOverlay } from '@yzt/map-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import { ElButton, ElDrawer, ElEmpty, ElOption, ElSelect } from 'element-plus';
import { useMediaQuery } from '@vueuse/core';
import { defineComponent, type PropType, ref, type SlotsType, type VNode, watch } from 'vue';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import { MapViewControls } from '@/shared/map/view-controls/MapViewControls';
import { MODULES, type PreviewRow, type PreviewScene, type QueryModule } from './preview-data';
import { PREVIEW_BACKGROUND, previewSelection } from './preview-map';
import { QueryConditionsPreview } from './QueryConditionsPreview';
import { QueryResultsPreview } from './QueryResultsPreview';
import { type QueryPreviewModel, useQueryPreview } from './useQueryPreview';
import styles from './preview.module.scss';

// 悬浮元素登记在提供地图的子组件中，定位复用公共避让能力
const QueryWorkspace = defineComponent({
  name: 'QueryWorkspace',
  props: { model: { type: Object as PropType<QueryPreviewModel>, required: true } },
  setup(props) {
    const map = useMap();
    const conditionPanel = ref<HTMLElement>();
    const resultPanel = ref<HTMLElement>();
    const selected = ref<PreviewRow>();
    const compact = useMediaQuery('(width < 1200px)');
    useMapOverlay(conditionPanel, 'left');
    useMapOverlay(resultPanel, 'bottom');
    watch(compact, () => (props.model.formOpen.value = !compact.value), { immediate: true });
    watch(() => props.model.submitted.value, () => (selected.value = undefined));
    const resetView = () => map.runCameraOperation(camera => camera.fitBounds([116.3, 30.7, 121.9, 35.2]));
    const locate = (row: PreviewRow) => {
      selected.value = row;
      map.runCameraOperation(camera => camera.flyTo({ center: [118.75, 32.03], zoom: 8 }));
    };

    return () => {
      const model = props.model;
      const available = model.layers.value.length > 0;
      return (
        <div class={styles.workspace}>
          <MapCanvas />
          <MapStatusNotice />
          <div class={styles.canvasLabel}>{model.title.value} · 本地边界与示例数据</div>
          {available ? (
            <div class={[styles.overlays, model.resultOpen.value && styles.withResults]}>
              <div class={styles.topArea}>
                {!compact.value && (
                  <div ref={conditionPanel} class={styles.conditionPanel}>
                    <QueryConditionsPreview model={model} />
                  </div>
                )}
                {compact.value && (
                  <ElButton class={styles.queryEntry} icon={Expand} onClick={() => (model.formOpen.value = true)}>
                    查询条件
                  </ElButton>
                )}
                {selected.value && (
                  <div class={styles.detailPanel}>
                    <MxPanel title="结果详情" class={styles.panel} headerTone="muted" floating>
                      {{
                        actions: () => (
                          <ElButton
                            link
                            icon={Close}
                            aria-label="关闭结果详情"
                            onClick={() => (selected.value = undefined)}
                          />
                        ),
                        default: () => (
                          <>
                            <MxTitle>{selected.value!.name}</MxTitle>
                            <p>{selected.value!.region} · {selected.value!.area} 平方米</p>
                          </>
                        )
                      }}
                    </MxPanel>
                  </div>
                )}
                <div class={styles.mapControls}>
                  <MapViewControls goToDefaultView={resetView} zoomRange={{ minZoom: 4, maxZoom: 18 }} />
                </div>
              </div>
              <div ref={resultPanel} class={[styles.results, model.maximized.value && styles.maximized]}>
                <QueryResultsPreview model={model} onLocate={locate} />
              </div>
            </div>
          ) : (
            <div class={styles.pendingPanel}>
              <MxPanel title={model.title.value} class={styles.panel} headerTone="muted" floating>
                <ElEmpty description="查询功能待建设" imageSize={64} />
                <p class={styles.hint}>旧版仅有地图页，尚无该模块的图层与查询配置。</p>
              </MxPanel>
            </div>
          )}
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
              <QueryConditionsPreview model={model} compact />
            </ElDrawer>
          )}
        </div>
      );
    };
  }
});

/** 四个业务入口共用的交互设计稿，真实接口与绘制工具待确认后接入 */
export const DevDataQueryPage = defineComponent({
  name: 'DevDataQueryPage',
  slots: Object as SlotsType<{ header: () => VNode[] }>,
  setup(_props, { slots }) {
    const model = useQueryPreview();
    const map = provideMap({
      groups: ['background', 'selection', 'boundaries'],
      camera: { center: [119.4, 32.9], zoom: 6.5, bearing: 0, pitch: 0 }
    });
    const boundaries = useBoundaries();
    boundaries.setVisible('city', true);
    map.bindStyle({
      background: () => PREVIEW_BACKGROUND,
      boundaries: boundaries.deriveGroup,
      selection: () => previewSelection(model.rangeReady.value, Boolean(model.submitted.value))
    });
    return () => (
      <div class={styles.page}>
        {slots.header()}
        <div class={styles.previewBar}>
          <strong>数据查询 · 交互预览</strong>
          <ElSelect
            aria-label="预览业务模块"
            modelValue={model.module.value}
            onUpdate:modelValue={(value: QueryModule) => (model.module.value = value)}
          >
            {MODULES.map(item => <ElOption key={item.value} value={item.value} label={item.label} />)}
          </ElSelect>
          <ElSelect
            aria-label="查询结果演示状态"
            modelValue={model.scene.value}
            onUpdate:modelValue={(value: PreviewScene) => (model.scene.value = value)}
          >
            <ElOption value="normal" label="正常结果" />
            <ElOption value="empty" label="空结果" />
            <ElOption value="loading" label="加载中" />
            <ElOption value="error" label="查询失败" />
          </ElSelect>
          <span class={styles.hint}>仅演示布局和操作，不读取业务数据</span>
        </div>
        <QueryWorkspace model={model} />
      </div>
    );
  }
});
