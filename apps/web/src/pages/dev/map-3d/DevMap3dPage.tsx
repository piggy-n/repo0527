import { BROWSE_TOOL, type MapTool, type ViewKind } from '@yzt/map-core';
import { provideMap } from '@yzt/map-vue';
import { useEventListener } from '@vueuse/core';
import { ElRadioButton, ElRadioGroup, ElSwitch } from 'element-plus';
import { computed, defineComponent, type PropType, ref, shallowRef, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { ResourceLayerPanel } from '@/features/resource-map/components/ResourceLayerPanel';
import { ResourceLegend } from '@/features/resource-map/components/ResourceLegend';
import { useResourceLayers } from '@/features/resource-map/composables/useResourceLayers';
import { useResourcePanelLayout } from '@/features/resource-map/composables/useResourcePanelLayout';
import { useResourceSymbols } from '@/features/resource-map/composables/useResourceSymbols';
import { useShownElementSize } from '@/shared/composables/useShownElementSize';
import { BasemapPanel } from '@/shared/map/basemap/BasemapPanel';
import { basemapOption } from '@/shared/map/basemap/basemap-style';
import { BasemapThumbnail } from '@/shared/map/basemap/BasemapThumbnail';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { BoundarySettingsPanel } from '@/shared/map/boundary/BoundarySettingsPanel';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { MapCard } from '@/shared/map/card/MapCard';
import { JIANGSU_CAMERA, JIANGSU_ZOOM_RANGE } from '@/shared/map/jiangsu';
import { MEASURE_TOOL_IDS } from '@/shared/map/measure/useMeasure';
import { MapPanelGroup, type PanelSlotProps } from '@/shared/map/panel-group/MapPanelGroup';
import { usePanelGroup } from '@/shared/map/panel-group/usePanelGroup';
import { useSideExclusion } from '@/shared/map/panel-group/useSideExclusion';
import { MapOptionsPopover } from '@/shared/map/popover/MapOptionsPopover';
import { FEATURE_PICK_TOOL } from '@/shared/map/toolbar/toolbar-items';
import { MapToolbar } from '@/shared/map/toolbar/MapToolbar';
import { MapViewControls } from '@/shared/map/view-controls/MapViewControls';
import { RouteName } from '@/shared/router/route-names';
import layout from '../../current-map/CurrentMapPage.module.scss';
import { mapPageLayout } from '../../current-map/map-page-layout';
import { SAMPLE_CATALOG, SAMPLE_THUMBNAILS } from '../map-ui/samples';
import { MinimapSketch } from './MinimapSketch';
import { ModelListPanel } from './ModelListPanel';
import { RoamPanel } from './RoamPanel';
import { SceneSketch } from './SceneSketch';
import { type DemoScenario, type ModelDemo, useModelDemo } from './useModelDemo';
import styles from './DevMap3dPage.module.scss';

const FUNCTION_PANELS = ['boundaries', 'legend', 'region-locate', 'coordinate-locate'] as const;
const PANEL_LABELS = {
  'region-locate': '区划定位',
  'coordinate-locate': '坐标定位',
  boundaries: '行政区',
  legend: '图例'
};

type FunctionPanel = (typeof FUNCTION_PANELS)[number];

// 和现状底图相同的工具栏：三维阶段全部保留（用户 2026-10-26 确定）
const TOOLBAR_GROUPS = [
  ['browse', 'feature-pick'],
  ['measure-distance', 'measure-area'],
  ['region-locate', 'coordinate-locate'],
  ['boundaries', 'legend'],
  ['clear']
] as const;

// 原型不量算、不识别：登记空的工具，工具栏照常切换按下状态
const PROTOTYPE_TOOLS: Readonly<Record<string, MapTool>> = {
  [FEATURE_PICK_TOOL]: { persistent: true },
  [MEASURE_TOOL_IDS.distance]: { persistent: false },
  [MEASURE_TOOL_IDS.area]: { persistent: false }
};

const SCENARIOS: readonly { value: DemoScenario; label: string }[] = [
  { value: 'normal', label: '常规清单' },
  { value: 'long', label: '含长名称' },
  { value: 'empty', label: '空清单' },
  { value: 'failed', label: '清单加载失败' }
];

const PROTOTYPE_TIANDITU = { key: 'prototype' };

const MapPrototype = defineComponent({
  name: 'MapPrototype',
  props: {
    owner: { type: Object as PropType<ModelDemo>, required: true },
    intranet: { type: Boolean, required: true }
  },
  setup(props) {
    const { owner } = props;
    const map = provideMap({ groups: ['basemap', 'resources'], camera: JIANGSU_CAMERA });
    map.registerTools(PROTOTYPE_TOOLS);
    const root = ref<HTMLElement>();
    const { width, height } = useShownElementSize(root);
    const pageLayout = computed(() => mapPageLayout(width.value, height.value));

    const dimension = ref<ViewKind>('2d');
    // 示意画面不请求天地图：公网时借用一个占位 key 得到矢量、影像两种选项
    const basemap = {
      ...useBasemap({ tianditu: props.intranet ? null : PROTOTYPE_TIANDITU }),
      thumbnails: SAMPLE_THUMBNAILS
    };
    const catalog = shallowRef(SAMPLE_CATALOG);
    const symbols = useResourceSymbols({ catalog });
    const resources = useResourceLayers(map, { catalog, symbols });
    const panelLayout = useResourcePanelLayout();
    const boundaries = useBoundaries();
    const modelsCollapsed = ref(false);

    // 漫游中（2026-10-28 的漫游原型）：左侧换成漫游面板，工具栏、功能面板、底图、视图控件和状态栏都隐藏，
    // 不能勾选模型、不能切二维；只隐藏不改状态，退出漫游后原样显示。没有单独的钻地，地下只在漫游地下的模型时出现
    const roaming = computed(() => dimension.value === '3d' && owner.roam.value.kind !== 'idle');

    const functions = usePanelGroup(FUNCTION_PANELS);
    const basemapOpen = ref(false);
    const leftCollapsed = computed(() =>
      dimension.value === '3d' ? modelsCollapsed.value : panelLayout.collapsed.value
    );
    const sides = useSideExclusion({
      leftExpanded: () => !leftCollapsed.value,
      rightOpen: () => functions.state.value.open.length > 0 || basemapOpen.value
    });

    // 二维切三维默认影像，三维切二维默认矢量（ADR 0078 第 2 节）；没有这种底图时（内网）保持原样
    const switchDimension = (next: ViewKind) => {
      owner.exitRoam();
      dimension.value = next;
      basemap.selectForDimension(next);
    };

    // 示意画面回到全省的俯视
    const goToDefaultView = () => {
      owner.exitRoam();
      owner.focus.value = null;
    };

    // 开始漫游时切回移动：测量、点选在漫游里不适用，退出后不恢复
    watch(roaming, entered => {
      if (entered) {
        map.activateTool(BROWSE_TOOL);
      }
    });
    // 漫游接管鼠标，相当于一个工具：选了移动以外的工具就退出漫游（开始漫游时切回移动不算）
    watch(map.activeTool, tool => {
      if (tool !== BROWSE_TOOL) {
        owner.exitRoam();
      }
    });

    const toggleFunction = (id: FunctionPanel) => {
      sides.activate('right');
      functions.toggle(id, sides.right.value);
    };
    const changeBasemapOpen = (open: boolean) => {
      basemapOpen.value = open;
      if (open) {
        sides.activate('right');
      }
    };
    const changeLeftCollapsed = (collapsed: boolean) => {
      if (dimension.value === '3d') {
        modelsCollapsed.value = collapsed;
      } else {
        panelLayout.setCollapsed(collapsed);
      }
      if (!collapsed) {
        sides.activate('left');
      }
    };
    const toolbarActions = {
      clear: () => undefined,
      'region-locate': () => toggleFunction('region-locate'),
      'coordinate-locate': () => toggleFunction('coordinate-locate'),
      boundaries: () => toggleFunction('boundaries'),
      legend: () => toggleFunction('legend')
    };
    const pressed = computed(() => {
      const { current } = functions.state.value;
      return sides.right.value && current !== null ? [current] : [];
    });

    // Esc 退出漫游；路线漫游时空格暂停或继续（焦点在输入框、按钮上时不拦截）
    useEventListener(window, 'keydown', (event: KeyboardEvent) => {
      const roam = owner.roam.value;
      if (roam.kind === 'idle') {
        return;
      }
      if (event.key === 'Escape') {
        owner.exitRoam();
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = target?.closest('input, textarea, button, [role="radio"]');
      if (event.key === ' ' && roam.kind === 'route' && !typing) {
        event.preventDefault();
        if (roam.phase === 'playing') {
          owner.pause();
        } else {
          owner.play();
        }
      }
    });

    // 状态栏：二维是比例尺和中心，三维是视点高度、中心和俯仰；漫游时不显示
    const readout = computed((): string[] => {
      const center = '中心 119.50°E, 33.00°N';
      if (dimension.value === '2d') {
        return ['比例尺 50 km', center];
      }
      if (owner.focus.value !== null) {
        return ['视点高度 2.4 km', center, '俯仰 -32°'];
      }
      return ['视点高度 420 km', center, '俯仰 -32°'];
    });

    const renderLegend = ({ active }: PanelSlotProps) => {
      if (dimension.value === '3d') {
        return [<p class={styles.note}>三维模式暂不显示资源图层，图例在切回二维后可用。</p>];
      }
      return [<ResourceLegend layers={resources} symbols={symbols} active={active} />];
    };

    const renderLeft = () => {
      if (roaming.value) {
        return <RoamPanel owner={owner} collapsed={!sides.left.value} onUpdate:collapsed={changeLeftCollapsed} />;
      }
      if (dimension.value === '3d') {
        return (
          <ModelListPanel
            owner={owner}
            collapsed={!sides.left.value}
            onUpdate:collapsed={changeLeftCollapsed}
          />
        );
      }
      return (
        <ResourceLayerPanel
          layers={resources}
          layout={panelLayout}
          collapsed={!sides.left.value}
          onUpdate:collapsed={changeLeftCollapsed}
        />
      );
    };

    const renderBasemapCard = () => {
      const current = basemapOption(basemap.selected.value);
      return (
        <div class={layout.cards}>
          <MapOptionsPopover
            name="prototype-basemap"
            label="底图"
            opacity={basemap.opacity.value}
            open={basemapOpen.value}
            visible={sides.right.value}
            onOpacityChange={basemap.setOpacity}
            onUpdate:open={changeBasemapOpen}
          >
            {{
              reference: () => [
                <MapCard
                  label={current.shortLabel}
                  name={`底图：${current.label}`}
                  pressed={sides.right.value && basemapOpen.value}
                >
                  {{ cover: () => [<BasemapThumbnail thumbnail={basemap.thumbnails[current.id]} />] }}
                </MapCard>
              ],
              default: () => [<BasemapPanel basemap={basemap} showOpacity={false} />]
            }}
          </MapOptionsPopover>
        </div>
      );
    };

    return () => {
      const { phone, toolbarColumns } = pageLayout.value;
      const pickUnsupported = dimension.value === '3d' && map.activeTool.value === FEATURE_PICK_TOOL;
      const roamingNow = roaming.value;
      const roam = owner.roam.value;
      // 小地图：步行进到站内以后、路线漫游一开始就有；手机宽度时漫游面板展开就不显示
      const minimapShown =
        roamingNow &&
        (roam.kind === 'route' || (roam.kind === 'walk' && roam.phase === 'walking')) &&
        (!phone || !sides.left.value);
      return (
        <div
          ref={root}
          class={[layout.root, phone && layout.phone]}
          style={{ '--map-tools-width': toolbarColumns ? '72px' : '40px' }}
        >
          <SceneSketch
            owner={owner}
            dimension={dimension.value}
            basemap={basemap.selected.value}
            pickUnsupported={pickUnsupported}
          />
          <div class={layout.overlay}>
            <div class={[layout.left, roamingNow && layout.noStatus]}>{renderLeft()}</div>
            <div class={layout.lane}>
              <div class={layout.panelStack}>
                <MapPanelGroup
                  class={layout.functions}
                  group={functions}
                  labels={PANEL_LABELS}
                  visible={sides.right.value && !roamingNow}
                >
                  {{
                    boundaries: ({ active }: PanelSlotProps) => [
                      <BoundarySettingsPanel boundaries={boundaries} active={active} />
                    ],
                    legend: renderLegend,
                    'region-locate': () => [<p class={styles.note}>区划定位在三维与二维相同（原型不演示）。</p>],
                    'coordinate-locate': () => [<p class={styles.note}>坐标定位在三维与二维相同（原型不演示）。</p>]
                  }}
                </MapPanelGroup>
              </div>
            </div>
            {minimapShown && (
              <div class={layout.minimap}>
                <MinimapSketch owner={owner} />
              </div>
            )}
            {!roamingNow && (
              <div class={layout.bottom}>
                <div class={[layout.status, styles.status]} role="status">
                  {readout.value.map(text => (
                    <span key={text}>{text}</span>
                  ))}
                </div>
              </div>
            )}
            <div class={layout.tools}>
              {!roamingNow && (
                <div class={layout.business}>
                  <MapToolbar
                    groups={TOOLBAR_GROUPS}
                    actions={toolbarActions}
                    pressed={pressed.value}
                    opened={functions.state.value.open}
                    compact
                    columns={toolbarColumns}
                  />
                </div>
              )}
              {!roamingNow && (
                <div class={layout.stack}>
                  <div class={layout.controls}>
                    <MapViewControls
                      goToDefaultView={goToDefaultView}
                      zoomRange={JIANGSU_ZOOM_RANGE}
                      dimension={dimension.value}
                      onUpdate:dimension={switchDimension}
                    />
                  </div>
                  {renderBasemapCard()}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    };
  }
});

/**
 * 三维迁移的交互原型：真实的地图页外壳与工具栏，加上原型的模型列表、漫游面板、小地图和示意画面
 * （2026-10-28 改为漫游面板，替换原来地图下方的漫游条和钻地条）
 */
export const DevMap3dPage = defineComponent({
  name: 'DevMap3dPage',
  setup() {
    const owner = useModelDemo();
    const scenario = ref<DemoScenario>('normal');
    const intranet = ref(false);

    const changeScenario = (value: unknown) => {
      const picked = SCENARIOS.find(item => item.value === value);
      if (picked) {
        scenario.value = picked.value;
        owner.setScenario(picked.value);
      }
    };
    // 换部署方式时重建原型（底图的选项跟着变），模型的临时状态一并清掉
    const changeIntranet = (value: unknown) => {
      intranet.value = value === true;
      owner.setScenario(scenario.value);
    };

    return () => (
      <main class={styles.page}>
        <header class={styles.bar}>
          <strong>三维迁移 · 交互原型</strong>
          <span class={styles.muted}>
            示意画面不是三维引擎；清单为固定样例，加载与漫游都是模拟。切到三维、勾选"星海广场站"，在"已加载"里点"漫游"
          </span>
          <span class={styles.group}>
            清单
            <ElRadioGroup size="small" modelValue={scenario.value} onUpdate:modelValue={changeScenario}>
              {SCENARIOS.map(item => (
                <ElRadioButton key={item.value} value={item.value}>
                  {item.label}
                </ElRadioButton>
              ))}
            </ElRadioGroup>
          </span>
          <span class={styles.group}>
            部署
            <ElRadioGroup size="small" modelValue={intranet.value} onUpdate:modelValue={changeIntranet}>
              <ElRadioButton value={false}>公网</ElRadioButton>
              <ElRadioButton value={true}>内网（无天地图）</ElRadioButton>
            </ElRadioGroup>
          </span>
          <ElSwitch
            size="small"
            activeText="下一次加载失败"
            modelValue={owner.failNext.value}
            onUpdate:modelValue={value => (owner.failNext.value = value === true)}
          />
          <nav class={styles.links}>
            <RouterLink to={{ name: RouteName.currentMap }}>现状底图</RouterLink>
            <RouterLink to={{ name: RouteName.devMapUi }}>地图交互样例</RouterLink>
          </nav>
        </header>
        <div class={styles.map}>
          <MapPrototype key={String(intranet.value)} owner={owner} intranet={intranet.value} />
        </div>
      </main>
    );
  }
});
