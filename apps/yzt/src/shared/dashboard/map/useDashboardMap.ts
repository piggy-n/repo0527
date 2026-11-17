import { computed, onMounted, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import { useDocumentVisibility, usePreferredReducedMotion, useResizeObserver } from '@vueuse/core';
import { gsap } from 'gsap';
import { Color } from 'three';
import { LatestController } from '@mx/utils';
import { DASHBOARD_CITIES as CITIES } from '../cities';
import type { MapClassification } from '../map-classification';
import type { IndicatorMeta } from '../model';
import { useChartFonts } from '../charts/useChartFonts';
import { loadDashboardRegions } from './region-geometry';
import { flatMapView, sceneMapView, type LngLat } from './map-view';
import { layoutMapLabels } from './label-layout';
import { JiangsuMapScene } from './JiangsuMapScene';
import { createFallback } from './fallback';
import { colorCoordinate, getMapColor, MAP_YEAR_TRANSITION } from './config';
import type { DashboardMapSnapshot, MapLabel, MapValues, MapView } from './types';

/** 地图要显示的数据，由调用方从自己的状态里取 */
export interface DashboardMapSource {
  values: () => MapValues;
  classification: () => MapClassification;
  indicator: () => IndicatorMeta;
}

interface DashboardMapOptions {
  fallback: () => boolean;
  reducedMotion: () => boolean;
  valuesVisible: () => boolean;
  /** 城市标签是否写数值；不写时二维降级只写名称，过渡中也不逐帧更新显示的数值 */
  showValues: () => boolean;
  /** 是否算地图的朝向和比例（指北针、比例尺用）；创建场景时读一次，和 showValues 一样按页面固定 */
  trackView?: () => boolean;
  hover: (code: string | null) => void;
  choose: (code: string) => void;
}

/** 组件只持有显示快照；加载、降级、重试和过渡都归同一生命周期 */
export function useDashboardMap(
  container: Ref<HTMLElement | undefined>,
  source: DashboardMapSource,
  options: DashboardMapOptions
) {
  const status = ref<'loading' | 'entering' | 'ready' | 'failed'>('loading');
  const simple = ref(false);
  const labels = shallowRef<MapLabel[]>([]);
  const labelScale = ref(1);
  const displayValues = shallowRef<MapValues>({});
  const hovered = ref<string | null>(null);
  const view = shallowRef<MapView | null>(null);
  const visibility = useDocumentVisibility();
  const preferredMotion = usePreferredReducedMotion();
  const reduced = computed(() => options.reducedMotion() || preferredMotion.value === 'reduce');
  const fontRevision = useChartFonts();
  const latest = new LatestController();
  let scene: JiangsuMapScene | undefined;
  let fallback: ReturnType<typeof createFallback> | undefined;
  let tween: gsap.core.Tween | undefined;
  let disposed = false;
  let colors: Record<string, string> = {};
  // 二维降级量比例用的中心经纬度；不算朝向和比例时为 undefined
  let viewCenter: LngLat | undefined;

  function hover(code: string | null): void {
    hovered.value = code;
    scene?.hoverRegion(code);
    options.hover(code);
  }

  function updateFallback(): void {
    fallback?.update(displayValues.value, colors, source.indicator(), options.showValues());
  }

  // 二维降级的范围只随容器尺寸变，创建和缩放后各量一次
  function measureFallback(): void {
    const flat = fallback;
    if (flat && viewCenter) {
      view.value = flatMapView(viewCenter, point => flat.toPixel(point));
    }
  }

  /** 标签数值与城市颜色使用同一进度，简化地图按较低频率重绘 */
  function transition(duration = 0): void {
    tween?.kill();
    const target = { ...source.values() };
    const colorValues = Object.fromEntries(
      CITIES.map(city => [city.code, colorCoordinate(target[city.code], source.classification())])
    );
    const targetColors = Object.fromEntries(CITIES.map(city => [city.code, getMapColor(colorValues[city.code])]));
    scene?.updateValues(colorValues, duration);
    if (!duration) {
      displayValues.value = target;
      colors = targetColors;
      updateFallback();
      return;
    }
    const initialValues = displayValues.value;
    const initialColors = { ...colors };
    const progress = { value: 0 };
    let lastFrame = 0;
    tween = gsap.to(progress, {
      value: 1,
      duration,
      ease: MAP_YEAR_TRANSITION.ease,
      paused: visibility.value === 'hidden',
      onUpdate: () => {
        if (options.showValues()) {
          displayValues.value = Object.fromEntries(CITIES.map(({ code }) => {
            const initialValue = initialValues[code];
            const targetValue = target[code];
            const canInterpolate = targetValue !== null && initialValue !== null && initialValue !== undefined;
            const value = canInterpolate ? initialValue + (targetValue - initialValue) * progress.value : targetValue;
            return [code, value];
          }));
        }
        colors = Object.fromEntries(CITIES.map(({ code }) => {
          const color = new Color(initialColors[code] ?? targetColors[code]);
          color.lerp(new Color(targetColors[code]), progress.value);
          return [code, `#${color.getHexString()}`];
        }));
        if (performance.now() - lastFrame >= 32) {
          updateFallback();
          lastFrame = performance.now();
        }
      },
      onComplete: () => {
        displayValues.value = target;
        colors = targetColors;
        updateFallback();
      }
    });
  }

  /** 重试和卸载共用释放流程，先终止过渡再移除引擎 */
  function release(): void {
    tween?.kill();
    scene?.dispose();
    fallback?.dispose();
    scene = undefined;
    fallback = undefined;
    labels.value = [];
    hovered.value = null;
    view.value = null;
    options.hover(null);
  }

  /** 重试作废上一次加载；图形初始化失败时使用同一份区划数据降级 */
  async function initialize(): Promise<void> {
    const signal = latest.next();
    release();
    status.value = 'loading';
    simple.value = false;
    try {
      const regions = await loadDashboardRegions(signal);
      if (signal.aborted || !container.value) {
        return;
      }
      const target = container.value;
      const tracking = options.trackView?.() ?? false;
      viewCenter = tracking ? regions.unproject(0, 0) : undefined;
      const activateFallback = () => {
        if (signal.aborted || disposed || fallback) {
          return;
        }
        scene?.dispose();
        scene = undefined;
        labels.value = [];
        simple.value = true;
        fallback = createFallback(target, regions, hover, options.choose);
        status.value = 'ready';
        transition();
        measureFallback();
      };
      if (options.fallback()) {
        activateFallback();
        return;
      }
      try {
        scene = new JiangsuMapScene(target, regions.regions, {
          onLabels: positions => {
            if (signal.aborted) {
              return;
            }
            const layout = layoutMapLabels(positions, target.clientWidth, target.clientHeight, options.showValues());
            labels.value = layout.labels;
            labelScale.value = layout.scale;
          },
          onHover: code => {
            hovered.value = code;
            if (!code) {
              options.hover(null);
            }
          },
          onCityPointer: options.hover,
          onCityClick: options.choose,
          // 不算朝向和比例时不传，场景不做投影和取样
          onView: tracking
            ? sceneView => {
              if (!signal.aborted) {
                view.value = sceneMapView(sceneView, regions.unproject);
              }
            }
            : undefined,
          onFailure: () => {
            try {
              activateFallback();
            } catch {
              status.value = 'failed';
              release();
            }
          }
        });
        status.value = 'entering';
        await scene.playEntrance(reduced.value);
        if (signal.aborted || disposed) {
          return;
        }
        status.value = 'ready';
        transition(reduced.value ? 0 : 0.85);
        if (!options.valuesVisible()) {
          displayValues.value = Object.fromEntries(CITIES.map(city => [city.code, 0]));
          tween?.kill();
        }
      } catch {
        if (!signal.aborted) {
          activateFallback();
        }
      }
    } catch {
      if (!signal.aborted) {
        release();
        status.value = 'failed';
      }
    }
  }

  watch(
    [source.values, source.classification],
    () => {
      hover(null);
      if (status.value === 'ready') {
        transition(reduced.value ? 0 : MAP_YEAR_TRANSITION.duration);
      }
    }
  );
  watch([fontRevision, options.showValues], updateFallback);
  watch(options.valuesVisible, value => {
    if (value && status.value === 'ready') {
      transition(reduced.value ? 0 : 0.85);
    }
  });
  watch(reduced, value => {
    scene?.setReducedMotion(value);
    if (value && status.value === 'ready') {
      transition();
    }
  });
  watch(visibility, state => {
    tween?.paused(state === 'hidden');
    hover(null);
    if (state === 'visible') {
      scene?.resize();
      fallback?.resize();
      updateFallback();
      measureFallback();
    }
  });
  useResizeObserver(container, () => {
    scene?.resize();
    fallback?.resize();
    measureFallback();
  });
  onMounted(() => {
    void initialize();
  });
  onScopeDispose(() => {
    disposed = true;
    latest[Symbol.dispose]();
    release();
  });

  /** 导出前结束当前数值过渡，像素和文字共同采用点击时的目标快照 */
  function capture(): DashboardMapSnapshot {
    if (status.value !== 'ready') {
      throw new Error('地图尚未就绪');
    }
    transition();
    const canvas = scene?.capture() ?? fallback?.capture();
    if (!canvas) {
      throw new Error('地图暂时无法导出');
    }
    return {
      canvas,
      labels: labels.value.map(label => ({ ...label })),
      values: { ...source.values() },
      simple: simple.value,
      labelScale: labelScale.value
    };
  }

  return {
    status,
    simple,
    labels,
    labelScale,
    displayValues,
    hovered,
    /** 地图的朝向和比例；没开 trackView、还没算出来或算不出来时为 null */
    view,
    hover,
    initialize,
    capture,
    settleValues: () => transition()
  };
}
