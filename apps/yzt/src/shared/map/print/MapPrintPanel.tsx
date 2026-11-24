import type { ViewKind } from '@mx/map-core';
import { useMap } from '@mx/map-vue';
import { MxTitle } from '@mx/ui';
import { ElButton, ElMessage, ElRadioButton, ElRadioGroup } from 'element-plus';
import { computed, defineComponent, onBeforeUnmount, onScopeDispose, type PropType, ref, shallowRef, watch } from 'vue';
import { saveFile } from '../../file-transfer';
import { composePrintImage, type LegendPlacement, type PrintImage, scaledPixels } from './print-image';
import type { MapPrint, PrintCapture, PrintSettings } from './useMapPrint';
import styles from './MapPrintPanel.module.scss';

const PLACEMENTS: readonly { readonly id: LegendPlacement; readonly label: string }[] = [
  { id: 'side', label: '右侧一栏' },
  { id: 'corner', label: '右下角' },
  { id: 'none', label: '不带' }
];

// 预览的宽度：浮层 320 减去两边 12 的内边距
const PREVIEW_WIDTH = 296;
// 预览最高多高：右侧一栏的长图例让图片变宽，高度跟着变矮，不会超过
const PREVIEW_MAX_HEIGHT = 200;

/**
 * 地图打印的浮层内容（ADR 0174，用户 2026-11-24 确认的做法二）：预览、图例的位置、清晰度、导出。预览在打开时、
 * 相机变了以后等画面完整截一次，改图例的位置只重新合成；导出等地图加载完，可以不等。导出的图片交给浏览器保存并提示；
 * 浮层关掉（卸载）时放弃没完成的导出
 */
export const MapPrintPanel = defineComponent({
  name: 'MapPrintPanel',
  props: {
    print: { type: Object as PropType<MapPrint>, required: true },
    settings: { type: Object as PropType<PrintSettings>, required: true },
    /** 浮层正在显示 */
    active: { type: Boolean, default: true },
    dimension: { type: String as PropType<ViewKind>, required: true }
  },
  emits: {
    'update:settings': (settings: PrintSettings) => typeof settings === 'object',
    /** 导出完了：页面关掉浮层 */
    done: () => true
  },
  setup(props, { emit }) {
    const map = useMap();
    const canvas = ref<HTMLCanvasElement>();
    // 上一次截下的画面和查没查图例：只改图例的位置时按它重新合成，不再截图、查要素
    let captured: { readonly capture: PrintCapture; readonly legend: boolean } | null = null;
    // 预览的图片（屏幕的像素比）；没有时说明原因
    const image = shallowRef<PrintImage | null>(null);
    const previewError = ref('');
    // 二维、屏幕不到 2 倍时才有更清楚的选项：三维照屏幕，屏幕已经是 2 倍时一样
    const doubleUsable = computed(() => props.dimension === '2d' && window.devicePixelRatio < 2);
    // 导出的像素：同屏幕时就是预览的图片；2 倍时按 2 倍的像素比算，地图受画布上限约束
    const exportSize = computed(() => {
      const current = image.value;
      if (!current) {
        return null;
      }
      return props.settings.double && doubleUsable.value
        ? scaledPixels(current, 2)
        : [current.canvas.width, current.canvas.height];
    });

    const show = (next: PrintImage | null) => {
      image.value = next;
      const target = canvas.value;
      const context = target?.getContext('2d');
      if (!next || !target || !context) {
        return;
      }
      const scale = Math.min(PREVIEW_WIDTH / next.canvas.width, PREVIEW_MAX_HEIGHT / next.canvas.height);
      const ratio = window.devicePixelRatio;
      const width = next.canvas.width * scale;
      const height = next.canvas.height * scale;
      target.width = Math.round(width * ratio);
      target.height = Math.round(height * ratio);
      target.style.width = `${width}px`;
      target.style.height = `${height}px`;
      context.drawImage(next.canvas, 0, 0, target.width, target.height);
    };

    const fail = (reason: unknown) => {
      show(null);
      previewError.value = reason instanceof Error ? reason.message : '预览失败';
    };

    // 按截下的画面和现在的图例位置合成预览
    const compose = () => {
      if (!captured) {
        show(null);
        return;
      }
      try {
        show(composePrintImage(captured.capture.snapshot, captured.capture.blocks, props.settings.legend));
        previewError.value = '';
      } catch (reason) {
        fail(reason);
      }
    };

    // 打开时、相机变了以后等画面完整再截一次：瓦片到了才完整，三维还等模型这一轮加载完。截图会请求重画但不改相机，
    // 不会再触发；导出时不截
    let capturing: AbortController | null = null;
    const recapture = async () => {
      capturing?.abort();
      capturing = null;
      if (!props.active) {
        return;
      }
      const controller = new AbortController();
      capturing = controller;
      const legend = props.settings.legend !== 'none';
      try {
        const capture = await props.print.capture(legend, controller.signal);
        if (capturing !== controller) {
          return;
        }
        captured = capture && { capture, legend };
        previewError.value = capture ? '' : '地图还没有就绪';
        compose();
      } catch (reason) {
        // 被下一次相机变化、关掉浮层作废，视图卸下了，或者正在导出：不画
        if (capturing === controller && !(reason instanceof DOMException && reason.name === 'AbortError')) {
          captured = null;
          fail(reason);
        }
      } finally {
        if (capturing === controller) {
          capturing = null;
        }
      }
    };
    watch(() => [props.active, map.projectionRevision.value] as const, () => void recapture(), {
      immediate: true,
      flush: 'post'
    });
    // 只改了清晰度时预览不变（同屏幕的像素比）；从不带换成带图例时上一次没有查图例，重新截
    watch(
      () => props.settings.legend,
      legend => {
        if (legend !== 'none' && !captured?.legend) {
          void recapture();
        } else {
          compose();
        }
      },
      { flush: 'post' }
    );
    onScopeDispose(() => capturing?.abort());
    onBeforeUnmount(() => props.print.cancel());

    const update = (patch: Partial<PrintSettings>) => emit('update:settings', { ...props.settings, ...patch });

    const exportImage = async () => {
      const double = props.settings.double && doubleUsable.value;
      const result = await props.print.run({ ...props.settings, double });
      if (!result) {
        return;
      }
      saveFile({ blob: result.blob, fileName: result.fileName });
      const moved = props.settings.legend === 'corner' && result.placement === 'side';
      ElMessage.success(moved ? `已导出 ${result.fileName}，图例较长，放在了右侧` : `已导出 ${result.fileName}`);
      emit('done');
    };

    return () => {
      const phase = props.print.phase.value;
      const busy = phase !== 'idle';
      const note = previewError.value || (image.value ? '' : '等待地图加载完成');
      return (
        <div class={styles.panel} data-map-print>
          <MxTitle>地图打印</MxTitle>
          <div class={styles.preview}>
            <canvas ref={canvas} class={[styles.image, note !== '' && styles.hidden]} aria-hidden="true" />
            {note !== '' && <span class={styles.empty}>{note}</span>}
          </div>
          {exportSize.value && (
            <div class={styles.meta} data-print-size>
              {exportSize.value[0]} × {exportSize.value[1]} 像素
            </div>
          )}
          <div class={styles.field}>
            <span class={styles.label}>图例</span>
            <ElRadioGroup
              class="radio-group-block"
              size="small"
              aria-label="图例"
              disabled={busy}
              modelValue={props.settings.legend}
              onUpdate:modelValue={value => {
                const placement = PLACEMENTS.find(item => item.id === value);
                if (placement) {
                  update({ legend: placement.id });
                }
              }}
            >
              {PLACEMENTS.map(item => (
                <ElRadioButton key={item.id} value={item.id}>
                  {item.label}
                </ElRadioButton>
              ))}
            </ElRadioGroup>
          </div>
          <div class={styles.field}>
            <span class={styles.label}>清晰度</span>
            <ElRadioGroup
              class="radio-group-block"
              size="small"
              aria-label="清晰度"
              disabled={busy}
              modelValue={props.settings.double && doubleUsable.value ? 'double' : 'screen'}
              onUpdate:modelValue={value => update({ double: value === 'double' })}
            >
              <ElRadioButton value="screen">同屏幕</ElRadioButton>
              <ElRadioButton value="double" disabled={!doubleUsable.value}>
                2 倍
              </ElRadioButton>
            </ElRadioGroup>
          </div>
          {!doubleUsable.value && (
            <div class={styles.note}>
              {props.dimension === '3d' ? '三维只能同屏幕的清晰度' : '屏幕已经是 2 倍的清晰度'}
            </div>
          )}
          {props.print.error.value !== '' && (
            <div class={styles.error} role="alert">
              {props.print.error.value}
            </div>
          )}
          <div class={styles.footer}>
            {phase === 'waiting' && (
              <span class={styles.waiting} data-print-waiting>
                等待地图加载完成
                <ElButton link type="primary" size="small" onClick={() => props.print.skipWait()}>
                  不等了
                </ElButton>
              </span>
            )}
            <ElButton type="primary" loading={busy} onClick={() => void exportImage()}>
              导出图片
            </ElButton>
          </div>
        </div>
      );
    };
  }
});
