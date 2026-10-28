import {
  levelBounds,
  levelLegend,
  localToPlane,
  MINOR_REGION_COLOR,
  type NavLevel,
  nodeOnLevel,
  OBSTACLE_COLOR,
  planeBounds,
  planeToLocal,
  renderFloorMap,
  type Rgb
} from '@yzt/map-core';
import { useElementSize } from '@vueuse/core';
import { ElButton, ElOption, ElRadioButton, ElRadioGroup, ElSelect, ElSwitch } from 'element-plus';
import { computed, defineComponent, nextTick, ref, shallowRef, watch } from 'vue';
import type { SceneModel } from '@/features/scene-models/catalog';
import { useSceneModelsQuery } from '@/features/scene-models/queries';
import { type NavGridResult, useNavGridBuild } from './useNavGridBuild';
import { WalkMapPreview } from './WalkMapPreview';
import styles from './DevNavGridPage.module.scss';

// 导航网格的实测页（ADR 0085 第 6 节）：构建清单里模型的导航网格，按楼层看正北朝上、按区域着色的平面图，叠加预置路线；
// 另有步行地图（小地图、完整地图）的组件预览（ADR 0087）

/** 平面图每像素 0.2 米，同网格的格子 */
const RES = 0.2;
// 路线的颜色是按数据画的，不走 CSS 令牌
const ROUTE_COLORS = ['#2278BE', '#16A34A', '#D9437F', '#C79212'];
const ZOOMS = [
  { value: 'fit', label: '适应宽度' },
  { value: '1', label: '1 像素 1 格' },
  { value: '3', label: '3 倍' }
] as const;
type Zoom = (typeof ZOOMS)[number]['value'];

interface FloorImage {
  readonly left: number;
  readonly top: number;
  readonly image: ImageData;
}

const rgb = ([r, g, b]: Rgb) => `rgb(${r} ${g} ${b})`;
const meters = (value: number) => `${value.toFixed(2)} 米`;

// 这一层画成 0.2 米一像素的图，范围由这一层的地面范围旋转到正北朝上得到
function floorImage(result: NavGridResult, level: NavLevel): FloorImage | null {
  const { grid, frame } = result.navigation;
  const bounds = levelBounds(grid, level);
  if (!bounds) {
    return null;
  }
  const { left, top, right, bottom } = planeBounds(bounds, frame.north);
  const image = new ImageData(Math.ceil((right - left) / RES), Math.ceil((top - bottom) / RES));
  renderFloorMap(grid, result.plan, level, image, { left, top, res: RES, north: frame.north });
  return { left, top, image };
}

// 路线在这一层上的几段（像素坐标）：两端都在这一层的高度范围里才画
function routeRuns(result: NavGridResult, model: SceneModel, level: NavLevel, floor: FloorImage) {
  const { frame } = result.navigation;
  return model.routes.map((route, index) => {
    const points = route.path.map(([lng, lat, height]) => {
      const [x, y, z] = frame.toLocal(lng, lat, height);
      const [east, north] = localToPlane(x, y, frame.north);
      return { px: (east - floor.left) / RES, py: (floor.top - north) / RES, z };
    });
    const runs: (typeof points)[] = [];
    let run: typeof points = [];
    for (const point of points) {
      if (point.z >= level.from && point.z < level.to) {
        run.push(point);
      } else {
        if (run.length > 1) {
          runs.push(run);
        }
        run = [];
      }
    }
    if (run.length > 1) {
      runs.push(run);
    }
    return { route, color: ROUTE_COLORS[index % ROUTE_COLORS.length], runs, points };
  });
}

/** 导航网格实测：/dev/nav-grid */
export const DevNavGridPage = defineComponent({
  name: 'DevNavGridPage',
  setup() {
    const query = useSceneModelsQuery(true);
    const models = computed(() => query.data.value ?? []);
    const selectedId = ref('');
    const selected = computed(() => models.value.find(model => model.id === selectedId.value) ?? null);
    // 清单已在查询缓存里时立即选上第一个
    watch(
      models,
      list => {
        if (!selectedId.value && list.length > 0) {
          selectedId.value = list[0].id;
        }
      },
      { immediate: true }
    );
    const { state, build } = useNavGridBuild();
    const levelIndex = ref(0);
    const showRoutes = ref(true);
    const zoom = ref<Zoom>('fit');
    // 看平面图，还是步行地图的预览
    const mode = ref<'plan' | 'walk'>('plan');
    const viewport = ref<HTMLElement>();
    const canvas = ref<HTMLCanvasElement>();
    const { width: viewportWidth } = useElementSize(viewport);
    const hover = shallowRef<string | null>(null);

    const result = computed(() => (state.value.kind === 'ready' ? state.value.result : null));
    const level = computed(() => result.value?.levels[levelIndex.value] ?? null);
    const floor = computed(() => (result.value && level.value ? floorImage(result.value, level.value) : null));
    const scale = computed(() => {
      const image = floor.value?.image;
      if (!image) {
        return 1;
      }
      if (zoom.value !== 'fit') {
        return Number(zoom.value);
      }
      return Math.min(3, Math.max(0.1, (viewportWidth.value - 32) / image.width));
    });

    watch(result, () => {
      levelIndex.value = 0;
      hover.value = null;
    });
    // 换了楼层，或者从预览切回来、画布重新挂上时重画
    watch(
      [floor, canvas],
      async ([image]) => {
        await nextTick();
        if (image) {
          canvas.value?.getContext('2d')?.putImageData(image.image, 0, 0);
        }
      },
      { flush: 'post' }
    );

    const startBuild = () => {
      const model = selected.value;
      const effect = model?.effects.find(item => item.id === model.defaultEffect) ?? model?.effects[0];
      if (model && effect) {
        void build(model.id, effect.url);
      }
    };

    // 鼠标处的经纬度、地板和区域
    const onPointerMove = (event: PointerEvent) => {
      const current = result.value;
      const image = floor.value;
      const currentLevel = level.value;
      if (!current || !image || !currentLevel || !(event.currentTarget instanceof HTMLElement)) {
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const east = image.left + ((event.clientX - rect.left) / scale.value) * RES;
      const north = image.top - ((event.clientY - rect.top) / scale.value) * RES;
      const { grid, frame } = current.navigation;
      const [x, y] = planeToLocal(east, north, frame.north);
      const cell = grid.cellOf(x, y);
      const node = cell ? nodeOnLevel(grid, cell[0], cell[1], currentLevel) : -1;
      const height = node === -1 ? currentLevel.height : grid.nodeFloor(node);
      const [lng, lat] = frame.toLngLat([x, y, height]);
      const region = node === -1 ? undefined : current.plan.regions.get(grid.componentOf(node));
      const where = region
        ? `地板 ${meters(height)} · 区域 ${region.id}（${Math.round(region.cells * current.plan.cellArea)} ㎡）`
        : '这一层没有能站的地板';
      hover.value = `${lng.toFixed(6)}, ${lat.toFixed(6)} · 局部 ${x.toFixed(1)}, ${y.toFixed(1)} · ${where}`;
    };

    const renderStatus = () => {
      const current = state.value;
      if (current.kind === 'idle') {
        return '选一个模型，构建它的导航网格';
      }
      if (current.kind === 'building') {
        const { progress } = current;
        if (!progress) {
          return '整理索引…';
        }
        return progress.stage === 'download' ? `下载瓦片 ${progress.done} / ${progress.total}` : '在 Worker 里构建…';
      }
      if (current.kind === 'failed') {
        return (
          <span class={styles.error}>
            构建失败：{current.error instanceof Error ? current.error.message : String(current.error)}
          </span>
        );
      }
      const { navigation, levels, plan, elapsed, tiles } = current.result;
      const { meta } = navigation.grid;
      const regions = [...plan.regions.values()].filter(region => region.color).length;
      return (
        `${tiles} 个瓦片，耗时 ${(elapsed / 1000).toFixed(1)} 秒；网格 ${meta.width} × ${meta.height}，` +
        `地板格 ${meta.floorCells}；${levels.length} 层，${plan.regions.size} 个区域（${regions} 个分到颜色）；` +
        `局部 y 轴方位 ${navigation.frame.north.toFixed(2)}°`
      );
    };

    const renderLegend = () => {
      const current = result.value;
      const currentLevel = level.value;
      if (!current || !currentLevel) {
        return null;
      }
      const items = levelLegend(current.plan, currentLevel);
      const shown = items.slice(0, 12);
      return (
        <section class={styles.section}>
          <h3>图例（{currentLevel.name}）</h3>
          <ul class={styles.legend}>
            {shown.map(({ region, area }) => (
              <li key={region.id}>
                <i
                  class={styles.swatch}
                  style={{
                    background: region.color
                      ? `linear-gradient(90deg, ${rgb(region.color.low)}, ${rgb(region.color.high)})`
                      : rgb(MINOR_REGION_COLOR)
                  }}
                />
                <span>区域 {region.id}</span>
                <span class={styles.muted}>
                  {Math.round(area)} ㎡ · {region.zMin.toFixed(1)}～{region.zMax.toFixed(1)} 米
                </span>
              </li>
            ))}
            {items.length > shown.length && <li class={styles.muted}>其余 {items.length - shown.length} 个区域</li>}
            <li>
              <i class={styles.swatch} style={{ background: rgb(OBSTACLE_COLOR) }} />
              <span>人站不下（贴墙、闸机、栏杆）</span>
            </li>
          </ul>
        </section>
      );
    };

    const renderMap = () => {
      const current = result.value;
      const image = floor.value;
      const currentLevel = level.value;
      if (!current || !image || !currentLevel) {
        return <div class={styles.empty}>{state.value.kind === 'ready' ? '这一层没有能站的地面' : ''}</div>;
      }
      const { width, height } = image.image;
      const routes = showRoutes.value && selected.value ? routeRuns(current, selected.value, currentLevel, image) : [];
      const lines = routes.flatMap(({ route, color, runs }) =>
        runs.map((run, index) => (
          <polyline
            key={`${route.id}-${index}`}
            points={run.map(({ px, py }) => `${px},${py}`).join(' ')}
            fill="none"
            stroke={color}
            stroke-width={3}
            vector-effect="non-scaling-stroke"
          />
        ))
      );
      // 起点、终点在这一层上时画圆点
      const ends = routes.flatMap(({ route, color, points }) =>
        [points[0], points.at(-1)]
          .filter(point => point && point.z >= currentLevel.from && point.z < currentLevel.to)
          .map((point, index) => (
            <circle
              key={`${route.id}-end-${index}`}
              cx={point?.px}
              cy={point?.py}
              r={5 / scale.value}
              fill={color}
              stroke="white"
              stroke-width={1.5}
              vector-effect="non-scaling-stroke"
            />
          ))
      );
      const barMeters = 20;
      return (
        <>
          <div class={styles.marks}>
            <span>北 ↑</span>
            <span class={styles.scaleBar}>
              <i style={{ width: `${(barMeters / RES) * scale.value}px` }} />
              {barMeters} 米
            </span>
          </div>
          <div
            class={styles.stage}
            style={{ width: `${width * scale.value}px`, height: `${height * scale.value}px` }}
            onPointermove={onPointerMove}
            onPointerleave={() => (hover.value = null)}
          >
            <canvas ref={canvas} class={styles.canvas} width={width} height={height} />
            <svg class={styles.overlay} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
              {lines}
              {ends}
            </svg>
          </div>
        </>
      );
    };

    return () => {
      const current = result.value;
      const building = state.value.kind === 'building';
      return (
        <main class={styles.root}>
          <header class={styles.toolbar}>
            <strong>导航网格实测</strong>
            <ElSelect
              class={styles.select}
              modelValue={selectedId.value}
              placeholder={query.isError.value ? '清单加载失败' : '选择模型'}
              onUpdate:modelValue={(value: unknown) => {
                selectedId.value = typeof value === 'string' ? value : '';
              }}
            >
              {models.value.map(model => (
                <ElOption key={model.id} value={model.id} label={`${model.name}（${model.cityName}）`} />
              ))}
            </ElSelect>
            <ElButton type="primary" loading={building} disabled={!selected.value} onClick={startBuild}>
              构建导航网格
            </ElButton>
            {current && (
              <ElRadioGroup
                modelValue={mode.value}
                onUpdate:modelValue={(value: unknown) => {
                  mode.value = value === 'walk' ? 'walk' : 'plan';
                }}
              >
                <ElRadioButton value="plan">平面图</ElRadioButton>
                <ElRadioButton value="walk">步行地图预览</ElRadioButton>
              </ElRadioGroup>
            )}
            <span class={styles.status}>{renderStatus()}</span>
          </header>
          <div class={styles.body}>
            <aside class={styles.aside}>
              {current && (
                <section class={styles.section}>
                  <h3>楼层</h3>
                  <ElRadioGroup
                    class={styles.levels}
                    modelValue={levelIndex.value}
                    onUpdate:modelValue={(value: unknown) => {
                      levelIndex.value = typeof value === 'number' ? value : 0;
                    }}
                  >
                    {current.levels.map(item => (
                      <ElRadioButton key={item.index} value={item.index}>
                        {item.name}（{item.height} 米）
                      </ElRadioButton>
                    ))}
                  </ElRadioGroup>
                </section>
              )}
              {renderLegend()}
              {current && (
                <section class={styles.section}>
                  <h3>显示</h3>
                  <label class={styles.option}>
                    <ElSwitch
                      modelValue={showRoutes.value}
                      onUpdate:modelValue={(value: unknown) => (showRoutes.value = value === true)}
                    />
                    预置路线
                  </label>
                  <ElRadioGroup
                    size="small"
                    modelValue={zoom.value}
                    onUpdate:modelValue={(value: unknown) => {
                      zoom.value = ZOOMS.find(item => item.value === value)?.value ?? 'fit';
                    }}
                  >
                    {ZOOMS.map(item => (
                      <ElRadioButton key={item.value} value={item.value}>
                        {item.label}
                      </ElRadioButton>
                    ))}
                  </ElRadioGroup>
                  {showRoutes.value && selected.value && selected.value.routes.length > 0 && (
                    <ul class={styles.legend}>
                      {selected.value.routes.map((route, index) => (
                        <li key={route.id}>
                          <i class={styles.line} style={{ background: ROUTE_COLORS[index % ROUTE_COLORS.length] }} />
                          {route.name}（{Math.round(route.length)} 米）
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </aside>
            <section ref={viewport} class={[styles.viewport, mode.value === 'walk' && styles.previewHost]}>
              {mode.value === 'walk' && current ? (
                <WalkMapPreview result={current} model={selected.value} />
              ) : (
                renderMap()
              )}
            </section>
          </div>
          <footer class={styles.readout}>{hover.value ?? '鼠标移到平面图上查看经纬度、地板高度和区域'}</footer>
        </main>
      );
    };
  }
});
