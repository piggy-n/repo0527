import type { ViewKind } from '@mx/map-core';
import { useMap } from '@mx/map-vue';
import { MxTitle } from '@mx/ui';
import { ElButton, ElMessage, ElRadioButton, ElRadioGroup } from 'element-plus';
import { computed, defineComponent, onBeforeUnmount, onMounted, onScopeDispose, type PropType, ref, watch } from 'vue';
import { saveFile } from '../../file-transfer';
import type { LegendPlacement } from './print-image';
import type { MapPrint, PrintSettings } from './useMapPrint';
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
 * 地图打印的浮层内容（ADR 0174，用户 2026-11-24 确认的做法二）：预览、图例的位置、清晰度、导出。预览按当前画面合成，
 * 打开时、改设置时、相机变了以后画面稳定时重画；导出等地图加载完，可以不等。导出的图片交给浏览器保存并提示；
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
    // 预览的图片多大（导出时同屏幕的像素），没有时说明原因
    const size = ref<readonly [number, number] | null>(null);
    const previewError = ref('');
    // 二维、屏幕不到 2 倍时才有更清楚的选项：三维照屏幕，屏幕已经是 2 倍时一样
    const doubleUsable = computed(() => props.dimension === '2d' && window.devicePixelRatio < 2);

    const refresh = () => {
      const target = canvas.value;
      if (!props.active || !target || props.print.phase.value !== 'idle') {
        return;
      }
      try {
        const image = props.print.preview(props.settings);
        previewError.value = image ? '' : '地图还没有就绪';
        size.value = image ? [image.canvas.width, image.canvas.height] : null;
        const context = target.getContext('2d');
        if (!image || !context) {
          return;
        }
        const scale = Math.min(PREVIEW_WIDTH / image.canvas.width, PREVIEW_MAX_HEIGHT / image.canvas.height);
        const ratio = window.devicePixelRatio;
        const width = image.canvas.width * scale;
        const height = image.canvas.height * scale;
        target.width = Math.round(width * ratio);
        target.height = Math.round(height * ratio);
        target.style.width = `${width}px`;
        target.style.height = `${height}px`;
        context.drawImage(image.canvas, 0, 0, target.width, target.height);
      } catch (reason) {
        size.value = null;
        previewError.value = reason instanceof Error ? reason.message : '预览失败';
      }
    };
    onMounted(refresh);
    watch(() => [props.active, props.settings] as const, refresh, { flush: 'post' });

    // 相机变了（或刚打开）以后等画面稳定再画一次，瓦片到了才完整；预览自己会请求重画，所以每次只等一次，不循环
    let settling: AbortController | null = null;
    const refreshWhenSettled = async () => {
      settling?.abort();
      if (!props.active) {
        return;
      }
      const controller = new AbortController();
      settling = controller;
      try {
        await map.whenSettled(controller.signal);
      } catch {
        // 被下一次相机变化、关掉浮层作废，或者视图卸下了：不画
        return;
      }
      if (settling === controller) {
        refresh();
      }
    };
    watch(() => [props.active, map.projectionRevision.value] as const, () => void refreshWhenSettled(), {
      immediate: true
    });
    onScopeDispose(() => settling?.abort());
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
      const failed = previewError.value !== '';
      return (
        <div class={styles.panel} data-map-print>
          <MxTitle>地图打印</MxTitle>
          <div class={styles.preview}>
            <canvas ref={canvas} class={[styles.image, failed && styles.hidden]} aria-hidden="true" />
            {failed && <span class={styles.empty}>{previewError.value}</span>}
          </div>
          {size.value && (
            <div class={styles.meta} data-print-size>
              {size.value[0]} × {size.value[1]} 像素
              {props.settings.double && doubleUsable.value && '，导出时宽高各放大到 2 倍'}
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
