import { computed, defineComponent, ref, watch, type PropType } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { DashboardModel } from '../composables/useDashboard';
import { useDashboardMap } from '../composables/useDashboardMap';
import { useImageExport } from '../composables/useImageExport';
import { imageWithTitle, saveImage } from '../export/image-export';
import { formatValue } from '../calculations';
import { colorCoordinate, getMapColor } from '../map/config';
import { DashboardTimeline } from './DashboardTimeline';
import { DashboardMapFrame } from './DashboardMapFrame';
import fonts from './DashboardFonts.module.scss';
import styles from './DashboardMap.module.scss';
import chartStyles from './DashboardCharts.module.scss';

/** 地图外壳组合场景、标签、图例、时间轴，保留独立大屏的布局 */
export const DashboardMap = defineComponent({
  name: 'DashboardMap',
  props: {
    model: { type: Object as PropType<DashboardModel>, required: true },
    forceFallback: { type: Boolean, default: false },
    reducedMotion: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    valuesVisible: { type: Boolean, default: true }
  },
  emits: { hover: (_code: string | null) => true, detail: (_code: string) => true, settled: () => true },
  setup(props, { emit, slots }) {
    const canvas = ref<HTMLElement>();
    const heading = ref<HTMLElement>();
    const headingHeight = ref(50);
    // 长指标换行后给地图保留真实标题高度，不按固定行数猜测
    useResizeObserver(heading, entries => {
      const element = entries[0]?.target;
      if (element) { headingHeight.value = element.getBoundingClientRect().height; }
    });
    const exporting = useImageExport();
    const map = useDashboardMap(canvas, props.model, {
      fallback: () => props.forceFallback, reducedMotion: () => props.reducedMotion, valuesVisible: () => props.valuesVisible,
      hover: code => emit('hover', code), choose: code => emit('detail', code)
    });
    watch(map.status, value => { if (value === 'ready' || value === 'failed') { emit('settled'); } });
    // 入场终态统一收敛数值，低帧率下也不残留尚未完成的递增显示
    watch(() => props.active, active => { if (active && map.status.value === 'ready') { map.settleValues(); } });
    const title = computed(() => props.model.state.value.activeYear === null ? '请选择年份'
      : `${props.model.state.value.activeYear}年江苏省${props.model.indicator.value.name}分布图（${props.model.indicator.value.unit}）`);
    const levels = computed(() => {
      const classification = props.model.classification.value;
      if (!classification.classCount) { return []; }
      const boundaries = [classification.displayMin!, ...classification.breaks];
      const precision = Math.min(20, Math.max(...[...boundaries, classification.displayMax!].map(value => {
        const [coefficient, exponent = '0'] = String(value).split('e');
        return Math.max(0, (coefficient.split('.')[1]?.length ?? 0) - Number(exponent));
      })));
      const format = (value: number) => formatValue(value, props.model.indicator.value, props.model.indicator.value.unit === '%', precision);
      return boundaries.map((min, index) => {
        const max = classification.breaks[index] ?? classification.displayMax!;
        return { color: getMapColor(colorCoordinate(min, classification)),
          label: min === max ? format(min) : `${format(min)} ~ ${index < boundaries.length - 1 ? '<' : ''}${format(max)}` };
      }).toReversed();
    });

    async function download(): Promise<void> {
      const exportTitle = title.value;
      const indicator = props.model.indicator.value;
      const filename = `江苏省-${props.model.state.value.activeYear}-${indicator.name}`;
      const blob = await exporting.run('map', async signal => {
        const snapshot = map.capture();
        await exporting.waitForFonts(signal);
        const context = snapshot.canvas.getContext('2d');
        if (!context) { throw new Error('地图导出画布不可用'); }
        if (!snapshot.simple) {
          context.save(); context.scale(2, 2); context.textAlign = 'center';
          snapshot.labels.forEach(label => {
            // 窄屏避让后的引线一同导出，文字描边保证深色城市上可读
            if (label.connected) {
              context.beginPath(); context.moveTo(label.anchorX, label.anchorY); context.lineTo(label.x, label.y);
              context.strokeStyle = '#FFFFFF'; context.lineWidth = .8; context.stroke();
            }
            context.font = `600 ${Math.max(14, 20 * snapshot.labelScale)}px "Alibaba PuHuiTi"`;
            context.fillStyle = '#0E4894'; context.strokeStyle = '#FFFFFF'; context.lineWidth = 1.5;
            context.strokeText(label.name, label.x, label.y - 12);
            context.fillText(label.name, label.x, label.y - 12);
            context.font = `600 ${Math.max(12, 14 * snapshot.labelScale)}px "Alibaba PuHuiTi"`; context.fillStyle = '#8B6500';
            const value = snapshot.values[label.code];
            if (value !== null) {
              const text = formatValue(value, indicator, indicator.unit.length <= 3);
              context.strokeText(text, label.x, label.y + 7); context.fillText(text, label.x, label.y + 7);
            }
          });
          context.restore();
        }
        return imageWithTitle(snapshot.canvas, exportTitle, '#D3EFFD');
      });
      if (blob) { saveImage(blob, filename); }
    }

    return () => {
      const model = props.model;
      const years = model.comparisonYears.value;
      const ready = map.status.value === 'ready';
      return <section class={[fonts.scope, styles.map]} aria-label="江苏省当前指标分布地图" data-state={map.status.value}
        style={{ '--map-heading-height': `${headingHeight.value}px` }}>
        <DashboardMapFrame />
        <div class={styles.texture} data-scene="surface" aria-hidden="true" />
        <div class={styles.orbit} data-scene="orbit" aria-hidden="true">
          <svg viewBox="0 0 600 600"><circle class={styles.orbitOuter} cx="300" cy="300" r="310" /><circle class={styles.orbitTicks} cx="300" cy="300" r="294" /><circle class={styles.orbitInner} cx="300" cy="300" r="270" /></svg>
        </div>
        <div class={styles.mist} data-scene="mist" aria-hidden="true" />
        <div ref={heading} class={styles.heading} data-enter="map-title" inert={!props.active}>
          <h2>{title.value}</h2>
          <button class={chartStyles.iconButton} type="button" aria-label="下载当前地图"
            disabled={!ready || !years.length || exporting.pending.value.has('map')} onClick={() => { void download(); }}>
            <SvgIcon name="dashboard-download" />
          </button>
        </div>
        <div class={styles.world} inert={!props.active && map.status.value !== 'failed'}>
          <div ref={canvas} class={styles.canvas} role="img" aria-label={`${model.indicator.value.name}${map.simple.value ? '二维' : '三维'}分布图`} />
          {ready && !map.simple.value && <div class={styles.labels} style={{ '--map-label-scale': map.labelScale.value }}>
            <svg class={styles.connectors} aria-hidden="true">{map.labels.value.filter(label => label.connected).map(label =>
              <line key={label.code} x1={label.anchorX} y1={label.anchorY} x2={label.x} y2={label.y} />)}</svg>
            {map.labels.value.map(label => <button key={label.code} type="button"
              class={[styles.label, model.mapValues.value[label.code] === null && styles.empty, map.hovered.value === label.code && styles.hovered]}
              style={{ left: `${label.x}px`, top: `${label.y}px` }} aria-haspopup="dialog"
              aria-label={`${label.name}，${formatValue(model.mapValues.value[label.code], model.indicator.value)}，查看详情`}
              onPointerenter={() => map.hover(label.code)} onPointerleave={() => map.hover(null)}
              onFocus={() => map.hover(label.code)} onBlur={() => map.hover(null)}
              onClick={() => { map.hover(null); emit('detail', label.code); }}>
              <strong>{label.name}</strong>
              {props.valuesVisible && model.mapValues.value[label.code] !== null && <span>{formatValue(map.displayValues.value[label.code], model.indicator.value, model.indicator.value.unit.length <= 3)}</span>}
            </button>)}
          </div>}
          {map.status.value === 'failed' && <div class={styles.failure} role="status"><p>地图暂时无法显示</p><button type="button" onClick={() => { void map.initialize(); }}>重新加载</button></div>}
        </div>
        {map.simple.value && ready && <small class={styles.note}>地图采用简化显示</small>}
        {map.status.value === 'loading' && <div class={styles.failure} role="status">地图加载中…</div>}
        <div class={styles.legend} data-enter="legend" aria-label="地图数值分级">{levels.value.map(level => <div key={level.label}><span style={{ background: level.color }} />{level.label}</div>)}</div>
        <div class={styles.timelinePosition} data-enter="timeline" inert={!props.active}>
          <DashboardTimeline years={years} activeYear={model.state.value.activeYear} ready={ready} reduced={props.reducedMotion} onChange={model.setActiveYear} />
        </div>
        {slots.default?.()}
        {exporting.error.value && <p class={styles.error} role="alert">{exporting.error.value}</p>}
      </section>;
    };
  }
});
