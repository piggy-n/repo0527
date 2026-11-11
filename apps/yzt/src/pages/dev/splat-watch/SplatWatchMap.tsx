import type { SceneContent, StyleGroup } from '@mx/map-core';
import { MAP_SCENE_ENGINE, MapCanvas, provideMap } from '@mx/map-vue';
import { computed, defineComponent, onMounted, onUnmounted, type PropType, provide, watch } from 'vue';
import type { SceneModel } from '@/features/scene-models/catalog';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import type { SplatProbe } from './splat-probe';
import styles from './DevSplatWatchPage.module.scss';

/** 看什么：只看泼溅、只看对照的倾斜模型（同一个相机切换着比亮处）、两者一起（倾斜模型在泼溅的范围里裁掉） */
export type WatchMode = 'splat' | 'reference' | 'both';

/** 背景色：按数据画的，不走 CSS 令牌 */
export const BACKGROUNDS = { dark: '#20262c', light: '#c8ccd0' } as const;
export type Background = keyof typeof BACKGROUNDS;

// 徐州，模型就绪后飞到模型的建议相机
const INITIAL_CAMERA = { center: [117.18, 34.27] as const, zoom: 16, pitch: 55, bearing: 0 };

/** 给子孙组件换三维引擎：provideMap 读的是上一级提供的引擎，所以单独一层；换预算时整个换掉（key） */
export const EngineScope = defineComponent({
  name: 'EngineScope',
  props: {
    probe: { type: Object as PropType<SplatProbe>, required: true },
    budget: { type: Number, required: true }
  },
  setup(props, { slots }) {
    provide(MAP_SCENE_ENGINE, props.probe.engine(props.budget));
    onUnmounted(() => props.probe.detach());
    return () => slots.default?.();
  }
});

function sceneContent(splat: SceneModel | null, reference: SceneModel | null, mode: WatchMode): SceneContent {
  const effect = reference?.effects[0];
  return {
    tilesets:
      reference && effect
        ? [{ id: reference.id, url: effect.url, show: mode !== 'splat', lighting: 'sun', clippedBySplats: mode === 'both', attempt: 0 }]
        : [],
    splats: splat?.splat ? [{ id: splat.id, ...splat.splat, show: mode !== 'reference', attempt: 0 }] : [],
    underground: null
  };
}

const backgroundStyle = (color: string): StyleGroup => ({
  sources: {},
  layers: [{ id: 'basemap-background', type: 'background', paint: { 'background-color': color } }]
});

/** 地图：只有背景色、一份泼溅和可选的对照模型；换到这份泼溅后第一次就绪时飞到它的建议相机 */
export const SplatWatchMap = defineComponent({
  name: 'SplatWatchMap',
  props: {
    splat: { type: Object as PropType<SceneModel | null>, default: null },
    reference: { type: Object as PropType<SceneModel | null>, default: null },
    mode: { type: String as PropType<WatchMode>, required: true },
    background: { type: String as PropType<Background>, required: true }
  },
  setup(props) {
    const map = provideMap({ groups: ['basemap'], camera: INITIAL_CAMERA });
    map.bindStyle({ basemap: () => backgroundStyle(BACKGROUNDS[props.background]) });
    map.bindScene(() => sceneContent(props.splat, props.reference, props.mode));
    // 画布挂上以后（子组件先挂）切到三维：这个引擎下二三维是同一个视图
    onMounted(() => map.setDimension('3d'));

    const statusOf = (model: SceneModel | null) => (model ? map.sceneStatus.value.get(model.id) : undefined);
    let located: string | null = null;
    watch(
      () => statusOf(props.splat),
      status => {
        const id = props.splat?.id;
        if (id && status?.state === 'ready' && located !== id) {
          located = id;
          map.runCameraOperation(control => control.flyTo(status.camera));
        }
      }
    );

    const describe = (model: SceneModel | null) => {
      const status = statusOf(model);
      if (!model) {
        return null;
      }
      if (!status) {
        return `${model.name}：等待`;
      }
      return status.state === 'failed' ? `${model.name}：失败（${String(status.error)}）` : `${model.name}：${status.state === 'ready' ? '就绪' : '加载中'}`;
    };
    const statusText = computed(() => [describe(props.splat), describe(props.reference)].filter(Boolean).join('；'));

    return () => (
      <div class={styles.map}>
        <MapCanvas class={styles.canvas} />
        <MapStatusNotice />
        {statusText.value && <div class={styles.status}>{statusText.value}</div>}
      </div>
    );
  }
});
