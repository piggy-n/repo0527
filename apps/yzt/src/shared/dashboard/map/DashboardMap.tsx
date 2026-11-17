import { computed, defineComponent, ref, watch, type PropType } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import { SvgIcon } from '../../icons/SvgIcon';
import { formatValue } from '../calculations';
import type { MapClassification } from '../map-classification';
import type { IndicatorMeta } from '../model';
import { useImageExport } from '../export/useImageExport';
import { imageWithTitle, saveImage } from '../export/image-export';
import fonts from '../shell/DashboardFonts.module.scss';
import chartStyles from '../charts/charts.module.scss';
import type { MapLabel, MapValues } from './types';
import { useDashboardMap } from './useDashboardMap';
import { drawMapLabels } from './map-export';
import { mapLegendLevels } from './config';
import { DashboardTimeline } from './DashboardTimeline';
import { DashboardMapFrame } from './DashboardMapFrame';
import styles from './DashboardMap.module.scss';

/** 地图外壳组合场景、标签、图例、时间轴，保留独立大屏的布局 */
export const DashboardMap = defineComponent({
  name: 'DashboardMap',
  props: {
    indicator: { type: Object as PropType<IndicatorMeta>, required: true },
    /** 地图上方的标题，由调用方按年份和指标拼好 */
    title: { type: String, required: true },
    values: { type: Object as PropType<MapValues>, required: true },
    classification: { type: Object as PropType<MapClassification>, required: true },
    /** 时间轴上的年份，从旧到新 */
    years: { type: Array as PropType<readonly number[]>, required: true },
    activeYear: { type: Number as PropType<number | null>, default: null },
    forceFallback: { type: Boolean, default: false },
    reducedMotion: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    valuesVisible: { type: Boolean, default: true }
  },
  emits: {
    hover: (_code: string | null) => true,
    detail: (_code: string) => true,
    settled: () => true,
    year: (_year: number) => true
  },
  setup(props, { emit, slots }) {
    const canvas = ref<HTMLElement>();
    const heading = ref<HTMLElement>();
    const headingHeight = ref(50);
    // 长指标换行后给地图保留真实标题高度，不按固定行数猜测
    useResizeObserver(heading, entries => {
      const element = entries[0]?.target;
      if (element) {
        headingHeight.value = element.getBoundingClientRect().height;
      }
    });
    const exporting = useImageExport();
    const source = {
      values: () => props.values,
      classification: () => props.classification,
      indicator: () => props.indicator
    };
    const map = useDashboardMap(canvas, source, {
      fallback: () => props.forceFallback,
      reducedMotion: () => props.reducedMotion,
      valuesVisible: () => props.valuesVisible,
      hover: code => emit('hover', code),
      choose: code => emit('detail', code)
    });
    watch(map.status, value => {
      if (value === 'ready' || value === 'failed') {
        emit('settled');
      }
    });
    // 入场终态统一收敛数值，低帧率下也不残留尚未完成的递增显示
    watch(
      () => props.active,
      active => {
        if (active && map.status.value === 'ready') {
          map.settleValues();
        }
      }
    );
    const levels = computed(() => mapLegendLevels(props.classification, props.indicator));

    /** 导出内容取点击时的快照，不受等待字体期间的筛选变化影响 */
    async function download(): Promise<void> {
      const exportTitle = props.title;
      const indicator = props.indicator;
      const filename = `江苏省-${props.activeYear}-${indicator.name}`;
      const blob = await exporting.run('map', async signal => {
        const snapshot = map.capture();
        await exporting.waitForFonts(signal);
        drawMapLabels(snapshot, indicator);
        return imageWithTitle(snapshot.canvas, exportTitle, '#D3EFFD');
      });
      if (blob) {
        saveImage(blob, filename);
      }
    }

    // 三维地图上的城市标签：名称和数值，点开详情；避让后离开锚点的画一条引线
    function renderLabel(label: MapLabel) {
      const value = props.values[label.code];
      const indicator = props.indicator;
      return (
        <button
          key={label.code}
          type="button"
          class={[styles.label, value === null && styles.empty, map.hovered.value === label.code && styles.hovered]}
          style={{ left: `${label.x}px`, top: `${label.y}px` }}
          aria-haspopup="dialog"
          aria-label={`${label.name}，${formatValue(value, indicator)}，查看详情`}
          onPointerenter={() => map.hover(label.code)}
          onPointerleave={() => map.hover(null)}
          onFocus={() => map.hover(label.code)}
          onBlur={() => map.hover(null)}
          onClick={() => {
            map.hover(null);
            emit('detail', label.code);
          }}
        >
          <strong>{label.name}</strong>
          {props.valuesVisible && value !== null && (
            <span>{formatValue(map.displayValues.value[label.code], indicator, indicator.unit.length <= 3)}</span>
          )}
        </button>
      );
    }

    function renderLabels() {
      const labels = map.labels.value;
      return (
        <div class={styles.labels} style={{ '--map-label-scale': map.labelScale.value }}>
          <svg class={styles.connectors} aria-hidden="true">
            {labels
              .filter(label => label.connected)
              .map(label => (
                <line key={label.code} x1={label.anchorX} y1={label.anchorY} x2={label.x} y2={label.y} />
              ))}
          </svg>
          {labels.map(renderLabel)}
        </div>
      );
    }

    return () => {
      const years = props.years;
      const ready = map.status.value === 'ready';
      return (
        <section
          class={[fonts.scope, styles.map]}
          aria-label="江苏省当前指标分布地图"
          data-state={map.status.value}
          style={{ '--map-heading-height': `${headingHeight.value}px` }}
        >
          <DashboardMapFrame />
          <div class={styles.texture} data-scene="surface" aria-hidden="true" />
          <div class={styles.orbit} data-scene="orbit" aria-hidden="true">
            {/* 每个圆环单独一个 svg，旋转整个 svg：SVG 内部元素的旋转不能交给合成线程，会每帧重绘 */}
            <svg class={styles.orbitOuter} viewBox="0 0 600 600">
              <circle cx="300" cy="300" r="310" />
            </svg>
            <svg class={styles.orbitTicks} viewBox="0 0 600 600">
              <circle cx="300" cy="300" r="294" />
            </svg>
            <svg class={styles.orbitInner} viewBox="0 0 600 600">
              <circle cx="300" cy="300" r="270" />
            </svg>
          </div>
          <div class={styles.mist} data-scene="mist" aria-hidden="true" />
          <div ref={heading} class={styles.heading} data-enter="map-title" inert={!props.active}>
            <h2>{props.title}</h2>
            <button
              class={chartStyles.iconButton}
              type="button"
              aria-label="下载当前地图"
              disabled={!ready || !years.length || exporting.pending.value.has('map')}
              onClick={() => void download()}
            >
              <SvgIcon name="dashboard-download" />
            </button>
          </div>
          <div class={styles.world} inert={!props.active && map.status.value !== 'failed'}>
            <div
              ref={canvas}
              class={styles.canvas}
              role="img"
              aria-label={`${props.indicator.name}${map.simple.value ? '二维' : '三维'}分布图`}
            />
            {ready && !map.simple.value && renderLabels()}
            {map.status.value === 'failed' && (
              <div class={styles.failure} role="status">
                <p>地图暂时无法显示</p>
                <button type="button" onClick={() => void map.initialize()}>
                  重新加载
                </button>
              </div>
            )}
          </div>
          {map.simple.value && ready && <small class={styles.note}>地图采用简化显示</small>}
          {map.status.value === 'loading' && <div class={styles.failure} role="status">地图加载中…</div>}
          <div class={styles.legend} data-enter="legend" aria-label="地图数值分级">
            {levels.value.map(level => (
              <div key={level.label}>
                <span style={{ background: level.color }} />
                {level.label}
              </div>
            ))}
          </div>
          <div class={styles.timelinePosition} data-enter="timeline" inert={!props.active}>
            <DashboardTimeline
              years={years}
              activeYear={props.activeYear}
              ready={ready}
              reduced={props.reducedMotion}
              onChange={year => emit('year', year)}
            />
          </div>
          {slots.default?.()}
          {exporting.error.value && <p class={styles.error} role="alert">{exporting.error.value}</p>}
        </section>
      );
    };
  }
});
