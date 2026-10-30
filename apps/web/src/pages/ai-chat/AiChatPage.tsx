import { MapCanvas, provideMap } from '@yzt/map-vue';
import { MxPanel, MxSplitLayout } from '@yzt/ui';
import { defineComponent, ref, watch } from 'vue';
import { aiResultGroup, resultBounds } from '@/features/ai-chat/ai-result-layer';
import { hasPanelContent } from '@/features/ai-chat/chat-result';
import { AiResultPanel } from '@/features/ai-chat/components/AiResultPanel';
import { ChatPanel } from '@/features/ai-chat/components/ChatPanel';
import { useAiChat } from '@/features/ai-chat/composables/useAiChat';
import { BasemapCard } from '@/shared/map/basemap/BasemapCard';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { JIANGSU_CAMERA, JIANGSU_ZOOM_RANGE } from '@/shared/map/jiangsu';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import { useDefaultView } from '@/shared/map/useDefaultView';
import { MapViewControls } from '@/shared/map/view-controls/MapViewControls';
import { SCROLL_ZOOM_RATES } from '@/shared/map/view-controls/zoom';
import styles from './AiChatPage.module.scss';

// 结果定位不再放大到比这一级更近（沿用旧项目）
const RESULT_MAX_ZOOM = 14;

/**
 * AI 对话：左侧对话面板，右侧上方是地图、下方是查询结果；最小迁移的范围与待办见 docs/modules/ai-chat.md。
 * 地图有底图（可以切换，不读写偏好）、省界和回答里的 GeoJSON
 */
export const AiChatPage = defineComponent({
  name: 'AiChatPage',
  setup() {
    // 回答的结果在底图之上、注记之下，边界在最上面
    const map = provideMap({
      groups: ['basemap', 'ai-result', 'basemap-labels', 'boundaries'],
      camera: JIANGSU_CAMERA
    });
    const { goToDefaultView } = useDefaultView(map);
    const basemap = useBasemap();
    const boundaries = useBoundaries();
    const chat = useAiChat();
    map.bindStyle({
      basemap: basemap.deriveGroup,
      'basemap-labels': basemap.deriveLabelsGroup,
      'ai-result': () => aiResultGroup(chat.latest.value?.result.geojson ?? null),
      boundaries: boundaries.deriveGroup
    });

    // 每次回答后：有图表或表格时展开结果区，有 GeoJSON 时定位到它的范围（用户提问引起的相机操作）
    const resultExpanded = ref(false);
    const resultMaximized = ref(false);
    const basemapOpen = ref(false);
    // 结果最大化时地图只剩一条，控制栏和底图都不显示，底图浮层一并关上
    const changeMaximized = (value: boolean) => {
      resultMaximized.value = value;
      if (value) {
        basemapOpen.value = false;
      }
    };
    watch(chat.latest, latest => {
      resultExpanded.value = hasPanelContent(latest?.result ?? null);
      resultMaximized.value = false;
      const geojson = latest?.result.geojson;
      const bounds = geojson ? resultBounds(geojson) : null;
      if (bounds) {
        map.runCameraOperation(camera => camera.fitBounds(bounds, { maxZoom: RESULT_MAX_ZOOM }));
      }
    });

    return () => (
      <MxSplitLayout asideLabel="AI 对话">
        {{
          aside: () => <ChatPanel chat={chat} />,
          default: () => [
            <div class={[styles.mapSlot, resultMaximized.value && styles.mapShrunk]}>
              <MxPanel flush>
                <div class={styles.map}>
                  <MapCanvas mapOptions={JIANGSU_ZOOM_RANGE} scrollZoomRates={SCROLL_ZOOM_RATES} />
                  {/* 结果最大化时地图只剩一条，放不下控制栏和底图卡片 */}
                  {!resultMaximized.value && (
                    <div class={styles.corner}>
                      <MapViewControls goToDefaultView={goToDefaultView} zoomRange={JIANGSU_ZOOM_RANGE} />
                      <BasemapCard
                        basemap={basemap}
                        open={basemapOpen.value}
                        onUpdate:open={open => (basemapOpen.value = open)}
                      />
                    </div>
                  )}
                  <MapStatusNotice />
                </div>
              </MxPanel>
            </div>,
            <div
              class={[
                styles.resultSlot,
                resultExpanded.value && styles.expanded,
                resultExpanded.value && resultMaximized.value && styles.maximized
              ]}
            >
              <AiResultPanel
                latest={chat.latest.value}
                expanded={resultExpanded.value}
                maximized={resultMaximized.value}
                onUpdate:expanded={value => (resultExpanded.value = value)}
                onUpdate:maximized={changeMaximized}
              />
            </div>
          ]
        }}
      </MxSplitLayout>
    );
  }
});
