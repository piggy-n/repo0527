import { Minus, Plus } from '@element-plus/icons-vue';
import { ElIcon } from 'element-plus';
import { computed, defineComponent, onMounted, type PropType, ref, watch } from 'vue';
import {
  DEFAULT_MINIMAP_RANGE,
  type IndoorMap,
  type MapPlayer,
  MINIMAP_RANGES,
  minimapRaster,
  minimapStale,
  planeHeading,
  playerLevel,
  toPlane
} from '../indoor-map/indoor-map';
import { scaleBar } from '../indoor-map/map-camera';
import { drawPlayer, drawRoute, drawTarget, markerColors, rasterCanvas } from '../indoor-map/map-draw';
import { type RouteTrack, trackOnLevel } from '../indoor-map/route-track';
import styles from './IndoorMinimap.module.scss';

/** 小地图的边长（CSS 像素） */
const SIZE = 180;
// 比例尺最长 60 像素
const SCALE_BAR_MAX = 60;

interface Sample {
  readonly level: number;
  readonly range: number;
  readonly center: readonly [number, number];
  readonly canvas: HTMLCanvasElement;
  readonly left: number;
  readonly top: number;
  readonly meters: number;
}

/**
 * 漫游时的小地图（ADR 0087，右上角 180 × 180）：以人为中心、正北朝上，显示人所在的楼层；
 * +/− 在 20～160 米之间逐档缩放；点地图打开完整地图。路线漫游时画出这一层上的路线（ADR 0097 第 6 节）
 */
export const IndoorMinimap = defineComponent({
  name: 'IndoorMinimap',
  props: {
    map: { type: Object as PropType<IndoorMap>, required: true },
    player: { type: Object as PropType<MapPlayer>, required: true },
    /** 路线漫游时的路线；步行时没有 */
    route: { type: Object as PropType<RouteTrack | null>, default: null }
  },
  emits: {
    open: () => true
  },
  setup(props, { emit }) {
    const canvas = ref<HTMLCanvasElement>();
    const range = ref(DEFAULT_MINIMAP_RANGE);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const level = computed(() => playerLevel(props.map, props.player));
    // 底图边长是显示范围的 1.5 倍，人走出一段、换了楼层或范围才重新采样；平时只平移、重画箭头
    let sample: Sample | null = null;
    const bar = computed(() => scaleBar(SIZE / range.value, SCALE_BAR_MAX));

    const draw = () => {
      const context = canvas.value?.getContext('2d');
      const current = level.value;
      if (!context || !current) {
        return;
      }
      const { map, player } = props;
      const center = toPlane(map, player.x, player.y);
      if (!sample || minimapStale(sample, current, range.value, center)) {
        const raster = minimapRaster(map, current, center, range.value);
        sample = {
          level: current.index,
          range: range.value,
          center,
          canvas: rasterCanvas(raster),
          left: raster.left,
          top: raster.top,
          meters: raster.image.width * raster.res
        };
      }
      const size = context.canvas.width;
      // 设备像素每米
      const scale = size / range.value;
      const colors = markerColors(context.canvas);
      context.clearRect(0, 0, size, size);
      context.save();
      context.translate(size / 2, size / 2);
      context.imageSmoothingEnabled = true;
      context.drawImage(
        sample.canvas,
        (sample.left - center[0]) * scale,
        (center[1] - sample.top) * scale,
        sample.meters * scale,
        sample.meters * scale
      );
      if (props.route) {
        const { all, passed } = trackOnLevel(map, current, props.route, player);
        const screen = (line: readonly (readonly [number, number])[]) =>
          line.map(([east, north]) => [(east - center[0]) * scale, (center[1] - north) * scale] as const);
        drawRoute(context, { all: all.map(screen), passed: passed.map(screen) }, 3 * dpr, colors);
      }
      if (player.target) {
        const [east, north] = toPlane(map, player.target.x, player.target.y);
        drawTarget(context, (east - center[0]) * scale, (center[1] - north) * scale, 3.5 * dpr, colors);
      }
      context.rotate(planeHeading(map, player));
      drawPlayer(context, { size: 9 * dpr, hfov: player.hfov, coneRadius: 40 * dpr }, colors);
      context.restore();
    };

    onMounted(draw);
    // 换了导航网格（另一个模型）时旧的底图作废
    watch(
      () => props.map,
      () => {
        sample = null;
      }
    );
    watch([() => props.player, () => props.map, () => props.route, range], draw, { flush: 'post' });

    const step = (offset: number) => {
      const next = MINIMAP_RANGES[MINIMAP_RANGES.indexOf(range.value) + offset];
      if (next !== undefined) {
        range.value = next;
      }
    };

    const onKeydown = (event: KeyboardEvent) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.isComposing) {
        event.preventDefault();
        emit('open');
      }
    };

    return () => {
      const index = MINIMAP_RANGES.indexOf(range.value);
      return (
        <div class={styles.minimap} data-indoor-minimap>
          <canvas
            ref={canvas}
            class={styles.canvas}
            width={SIZE * dpr}
            height={SIZE * dpr}
            role="button"
            tabindex={0}
            aria-label="站内小地图，点击查看完整地图"
            title="点击查看完整地图"
            onClick={() => emit('open')}
            onKeydown={onKeydown}
          />
          <span class={styles.level}>{level.value?.name ?? '-'} · 北↑</span>
          <span class={styles.scale}>
            <i style={{ width: `${bar.value.pixels}px` }} />
            {bar.value.meters} m
          </span>
          <div class={styles.zoom}>
            <button
              type="button"
              class={styles.zoomButton}
              aria-label="放大"
              disabled={index <= 0}
              onClick={() => step(-1)}
            >
              <ElIcon>
                <Plus />
              </ElIcon>
            </button>
            <button
              type="button"
              class={styles.zoomButton}
              aria-label="缩小"
              disabled={index >= MINIMAP_RANGES.length - 1}
              onClick={() => step(1)}
            >
              <ElIcon>
                <Minus />
              </ElIcon>
            </button>
          </div>
        </div>
      );
    };
  }
});
