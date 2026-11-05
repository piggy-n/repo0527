import { Aim, Close, Minus, Plus } from '@element-plus/icons-vue';
import type { NavLevel, NavPoint } from '@yzt/map-core';
import { MxPanel } from '@yzt/ui';
import { ElButton, ElRadioButton, ElRadioGroup, ElTooltip } from 'element-plus';
import {
  computed,
  defineComponent,
  nextTick,
  onMounted,
  onScopeDispose,
  type PropType,
  ref,
  shallowRef,
  watch
} from 'vue';
import { useShownElementSize } from '@/shared/composables/useShownElementSize';
import { MAP_TOOLTIP_PROPS } from '@/shared/map/tooltip';
import {
  type IndoorMap,
  levelRaster,
  type MapPlayer,
  pickOnLevel,
  planeHeading,
  type PlaneRaster,
  playerLevel,
  toPlane
} from '../indoor-map/indoor-map';
import {
  fitCamera,
  keepCamera,
  type MapCamera,
  MAX_SCALE,
  panCamera,
  planeToScreen,
  scaleBar,
  screenToPlane,
  zoomCamera
} from '../indoor-map/map-camera';
import { drawLocator, drawPlayer, drawRoute, drawTarget, markerColors, rasterCanvas } from '../indoor-map/map-draw';
import { type RouteTrack, trackOnLevel } from '../indoor-map/route-track';
import styles from './IndoorMapDialog.module.scss';

// +/− 每次缩放的倍数，滚轮每像素的缩放量
const BUTTON_ZOOM = 1.5;
const WHEEL_ZOOM = 0.0015;
// 滚轮按行、按页滚动时换成像素
const WHEEL_LINE = 33;
const WHEEL_PAGE = 600;
const HINT = '双击地图瞬移 · 拖动平移 · 滚轮缩放';
// 路线漫游时不能瞬移（ADR 0097 第 6 节）
const ROUTE_HINT = '拖动平移 · 滚轮缩放';
// 提示显示这么久后换回操作说明（毫秒）
const MESSAGE_DURATION = 2500;
// 比例尺最长 160 像素
const SCALE_BAR_MAX = 160;

interface LevelImage {
  readonly raster: PlaneRaster;
  readonly canvas: HTMLCanvasElement;
}

/**
 * 站内的完整地图（ADR 0087）：正北朝上，打开时显示人所在的那一层；顶部切换楼层，"定位到我"回到人所在的楼层和位置，
 * 拖动平移、滚轮或 +/− 缩放；双击某处瞬移到这一层离它最近的能站位置。点外面、×、Esc 关闭。
 * 路线漫游时画出这一层上的路线，不能瞬移（ADR 0097 第 6 节）
 */
export const IndoorMapDialog = defineComponent({
  name: 'IndoorMapDialog',
  props: {
    map: { type: Object as PropType<IndoorMap>, required: true },
    player: { type: Object as PropType<MapPlayer>, required: true },
    /** 路线漫游时的路线；步行时没有 */
    route: { type: Object as PropType<RouteTrack | null>, default: null },
    /** 能双击瞬移：步行时能，路线漫游时不能 */
    teleport: { type: Boolean, default: true }
  },
  emits: {
    teleport: (_spot: NavPoint) => true,
    close: () => true
  },
  setup(props, { emit }) {
    const root = ref<HTMLElement>();
    const body = ref<HTMLElement>();
    const canvas = ref<HTMLCanvasElement>();
    const { width, height } = useShownElementSize(body);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const here = computed(() => playerLevel(props.map, props.player));
    const level = shallowRef<NavLevel | null>(here.value);
    const camera = shallowRef<MapCamera | null>(null);
    const minScale = ref(0);
    const message = ref<string | null>(null);
    let messageTimer: ReturnType<typeof setTimeout> | undefined;
    // 各层的底图第一次看时画，之后复用
    const images = new Map<number, LevelImage | null>();

    const imageOf = (target: NavLevel): LevelImage | null => {
      if (!images.has(target.index)) {
        const raster = levelRaster(props.map, target);
        images.set(target.index, raster ? { raster, canvas: rasterCanvas(raster) } : null);
      }
      return images.get(target.index) ?? null;
    };

    const view = () => ({ width: width.value, height: height.value });
    const boxOf = ({ raster }: LevelImage) => ({
      left: raster.left,
      top: raster.top,
      width: raster.image.width * raster.res,
      height: raster.image.height * raster.res
    });

    // 打开地图、"定位到我"：整层放得下就整层显示，否则以人为中心
    const fitTo = (target: NavLevel) => {
      level.value = target;
      const image = imageOf(target);
      if (image && width.value > 0) {
        const fitted = fitCamera(boxOf(image), view(), toPlane(props.map, props.player.x, props.player.y));
        camera.value = fitted.camera;
        minScale.value = fitted.minScale;
      }
    };

    // 点楼层按钮：位置和缩放不变，看的是正上方、正下方的同一片，好对照上下层
    const selectLevel = (target: NavLevel) => {
      level.value = target;
      const image = imageOf(target);
      if (image && camera.value) {
        const kept = keepCamera(camera.value, boxOf(image), view());
        camera.value = kept.camera;
        minScale.value = kept.minScale;
      } else {
        fitTo(target);
      }
    };

    const locate = () => {
      const target = here.value;
      if (!target) {
        return;
      }
      if (target !== level.value || !camera.value) {
        fitTo(target);
      }
      const [east, north] = toPlane(props.map, props.player.x, props.player.y);
      if (camera.value) {
        camera.value = { ...camera.value, east, north };
      }
    };

    const draw = () => {
      const context = canvas.value?.getContext('2d');
      const current = camera.value;
      const shown = level.value;
      const image = shown && imageOf(shown);
      if (!context || !current || !image) {
        return;
      }
      const { map, player } = props;
      const size = view();
      const colors = markerColors(context.canvas);
      context.clearRect(0, 0, context.canvas.width, context.canvas.height);
      context.save();
      context.scale(dpr, dpr);
      const box = boxOf(image);
      const [x, y] = planeToScreen(current, size, box.left, box.top);
      // 放得很大时保持格子清晰，不糊成一片
      context.imageSmoothingEnabled = image.raster.res * current.scale < 3;
      context.drawImage(image.canvas, x, y, box.width * current.scale, box.height * current.scale);
      if (props.route) {
        const lines = trackOnLevel(map, shown, props.route, here.value === shown ? player : null);
        const screen = (line: readonly (readonly [number, number])[]) =>
          line.map(([east, north]) => planeToScreen(current, size, east, north));
        drawRoute(context, { all: lines.all.map(screen), passed: lines.passed.map(screen) }, 3, colors);
      }
      // 人画在所在的那一层上；看别的楼层时只用淡淡的定位圈标出人的平面位置
      const [px, py] = planeToScreen(current, size, ...toPlane(map, player.x, player.y));
      context.save();
      context.translate(px, py);
      drawLocator(context, 16, colors);
      if (here.value === shown) {
        context.rotate(planeHeading(map, player));
        drawPlayer(context, { size: 10, hfov: player.hfov, coneRadius: 56 }, colors);
      }
      context.restore();
      if (player.target && here.value === shown) {
        const [tx, ty] = planeToScreen(current, size, ...toPlane(map, player.target.x, player.target.y));
        drawTarget(context, tx, ty, 4, colors);
      }
      context.restore();
    };

    const flash = (text: string) => {
      clearTimeout(messageTimer);
      message.value = text;
      messageTimer = setTimeout(() => (message.value = null), MESSAGE_DURATION);
    };
    onScopeDispose(() => clearTimeout(messageTimer));

    // 尺寸量到后取景；之后尺寸变了按原来的中心和比例重画
    watch([width, height], ([w]) => {
      if (w > 0 && !camera.value) {
        fitTo(level.value ?? here.value ?? props.map.levels[0]);
      }
    });
    watch([camera, level, () => props.player, () => props.route, width, height], () => void nextTick(draw), {
      flush: 'post'
    });
    onMounted(() => {
      root.value?.focus({ preventScroll: true });
      if (width.value > 0 && level.value) {
        fitTo(level.value);
      }
    });

    // 拖动平移；双击瞬移
    let drag: { readonly id: number; x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) {
        return;
      }
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id || !camera.value) {
        return;
      }
      camera.value = panCamera(camera.value, event.clientX - drag.x, event.clientY - drag.y);
      drag.x = event.clientX;
      drag.y = event.clientY;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (drag && event.pointerId === drag.id) {
        drag = null;
      }
    };
    const localPoint = (event: MouseEvent): [number, number] => {
      const box = canvas.value?.getBoundingClientRect();
      return box ? [event.clientX - box.left, event.clientY - box.top] : [0, 0];
    };
    const onDoubleClick = (event: MouseEvent) => {
      const current = camera.value;
      const shown = level.value;
      if (!current || !shown) {
        return;
      }
      if (!props.teleport) {
        flash('路线漫游时不能瞬移');
        return;
      }
      const [east, north] = screenToPlane(current, view(), ...localPoint(event));
      const spot = pickOnLevel(props.map, shown, east, north);
      if (spot) {
        emit('teleport', spot);
      } else {
        flash('这附近没有可以到达的地面');
      }
    };
    // 以 point（画布上的点）为不动点缩放，不传时以中心
    const zoomBy = (factor: number, point?: [number, number]) => {
      const current = camera.value;
      if (!current) {
        return;
      }
      camera.value = point
        ? zoomCamera(current, view(), factor, minScale.value, point[0], point[1])
        : zoomCamera(current, view(), factor, minScale.value);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE : 1;
      const pixels = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? WHEEL_PAGE : unit);
      zoomBy(Math.exp(-pixels * WHEEL_ZOOM), localPoint(event));
    };
    // Esc 先关地图，不传到页面（页面上 Esc 是退出漫游）
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        emit('close');
      }
    };

    const renderLevels = () => (
      <ElRadioGroup
        size="small"
        aria-label="楼层"
        modelValue={level.value?.index ?? -1}
        onUpdate:modelValue={(value: unknown) => {
          const target = props.map.levels.find(item => item.index === value);
          if (target) {
            selectLevel(target);
          }
        }}
      >
        {props.map.levels.map(item => (
          <ElRadioButton key={item.index} value={item.index}>
            {item === here.value ? `${item.name}（当前）` : item.name}
          </ElRadioButton>
        ))}
      </ElRadioGroup>
    );

    return () => {
      const current = camera.value;
      const bar = current ? scaleBar(current.scale, SCALE_BAR_MAX) : null;
      return (
        <div
          ref={root}
          class={styles.overlay}
          tabindex={-1}
          data-indoor-map
          onPointerdown={(event: PointerEvent) => {
            if (event.target === root.value) {
              emit('close');
            }
          }}
          onKeydown={onKeydown}
        >
          <MxPanel title="站内地图" class={styles.panel} headerTone="muted" floating flush>
            {{
              actions: () => [
                <ElButton link icon={Close} aria-label="关闭站内地图" onClick={() => emit('close')} />
              ],
              subheader: () => [
                <div class={styles.tools}>
                  {renderLevels()}
                  <span class={[styles.hint, message.value && styles.message]} role="status">
                    {message.value ?? (props.teleport ? HINT : ROUTE_HINT)}
                  </span>
                  <ElButton size="small" icon={Aim} onClick={locate}>
                    定位到我
                  </ElButton>
                  <span class={styles.zoom}>
                    <ElTooltip {...MAP_TOOLTIP_PROPS} content="放大" placement="bottom">
                      <ElButton
                        size="small"
                        icon={Plus}
                        aria-label="放大"
                        disabled={!current || current.scale >= MAX_SCALE - 1e-6}
                        onClick={() => zoomBy(BUTTON_ZOOM)}
                      />
                    </ElTooltip>
                    <ElTooltip {...MAP_TOOLTIP_PROPS} content="缩小" placement="bottom">
                      <ElButton
                        size="small"
                        icon={Minus}
                        aria-label="缩小"
                        disabled={!current || current.scale <= minScale.value + 1e-6}
                        onClick={() => zoomBy(1 / BUTTON_ZOOM)}
                      />
                    </ElTooltip>
                  </span>
                </div>
              ],
              default: () => [
                <div ref={body} class={styles.body}>
                  <canvas
                    ref={canvas}
                    class={styles.canvas}
                    width={Math.max(1, Math.round(width.value * dpr))}
                    height={Math.max(1, Math.round(height.value * dpr))}
                    aria-label={props.teleport ? '站内地图，双击瞬移' : '站内地图'}
                    onPointerdown={onPointerDown}
                    onPointermove={onPointerMove}
                    onPointerup={onPointerUp}
                    onPointercancel={onPointerUp}
                    onDblclick={onDoubleClick}
                    onWheel={onWheel}
                  />
                  <span class={styles.level}>{level.value?.name ?? '-'} · 北↑</span>
                  {bar && (
                    <span class={styles.scale} data-scale-bar>
                      <i style={{ width: `${bar.pixels}px` }} />
                      {bar.meters} m
                    </span>
                  )}
                </div>
              ]
            }}
          </MxPanel>
        </div>
      );
    };
  }
});
