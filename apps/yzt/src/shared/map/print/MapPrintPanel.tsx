import { Download, Loading, ScaleToOriginal, ZoomIn, ZoomOut } from '@element-plus/icons-vue';
import type { ViewKind } from '@mx/map-core';
import { useMap } from '@mx/map-vue';
import { MxPanel } from '@mx/ui';
import {
  ElButton,
  ElIcon,
  ElImageViewer,
  ElInput,
  ElMessage,
  ElRadioButton,
  ElRadioGroup,
  type ImageViewerAction
} from 'element-plus';
import {
  computed,
  defineComponent,
  nextTick,
  onBeforeUnmount,
  onScopeDispose,
  type PropType,
  ref,
  shallowRef,
  type VNode,
  watch
} from 'vue';
import { saveFile } from '../../file-transfer';
import { SvgIcon } from '../../icons/SvgIcon';
import {
  composePrintImage,
  type LegendPlacement,
  type PrintImage,
  scaledPixels,
  type TitlePlacement
} from './print-image';
import { type MapPrint, type PrintCapture, type PrintResult, type PrintSettings, printTitle } from './useMapPrint';
import styles from './MapPrintPanel.module.scss';

const PLACEMENTS: readonly { readonly id: LegendPlacement; readonly label: string }[] = [
  { id: 'side', label: '右侧一栏' },
  { id: 'corner', label: '右下角' },
  { id: 'none', label: '不带' }
];

const TITLE_PLACEMENTS: readonly { readonly id: TitlePlacement; readonly label: string }[] = [
  { id: 'header', label: '顶部一栏' },
  { id: 'map', label: '地图上' }
];

// 标题最多多少个字：顶部一栏里 22 号字就放得下
const TITLE_MAX_LENGTH = 40;

// 预览的宽度：浮层 320 减去两边的边框 1、内边距 16、预览的边框 1
const PREVIEW_WIDTH = 284;
// 预览最高多高：右侧一栏的长图例让图片变宽，高度跟着变矮，不会超过
const PREVIEW_MAX_HEIGHT = 200;

// 大图预览的工具栏（ElImageViewer 的 toolbar 插槽）交给的操作
interface ViewerToolbar {
  readonly actions: (action: ImageViewerAction) => void;
  readonly reset: () => void;
}

// 空格激活大图工具栏的按钮时，不让按下冒泡到大图在 document 上的快捷键（空格切换原始大小），不然会多切一次；
// 不 preventDefault，按钮照常在松开时点击
const keepSpace = (event: KeyboardEvent) => {
  if (event.key === ' ' || event.code === 'Space') {
    event.stopPropagation();
  }
};

// 大图工具栏的一个按钮：只有图标，名称在提示和读屏里
const viewerButton = (label: string, icon: VNode, onClick: () => void) => (
  <button
    type="button"
    class={styles.viewerButton}
    aria-label={label}
    title={label}
    onKeydown={keepSpace}
    onClick={onClick}
  >
    <ElIcon>{icon}</ElIcon>
  </button>
);

// 右下角放不下、改到了右侧
const movedText = (requested: LegendPlacement, result: PrintResult) =>
  requested === 'corner' && result.placement === 'side' ? '，图例较长，放在了右侧' : '';

/**
 * 地图打印的浮层内容（ADR 0174，用户 2026-11-24 确认的做法二和第 8 批的调整）：浅灰标题栏右边是"导出"，下面是预览、
 * 标题和它的位置（用户 2026-11-25）、图例的位置、清晰度。预览在打开时、相机变了以后等画面完整截一次，改标题、图例的位置
 * 只重新合成；点预览按现在的设置生成导出的那张图，
 * 用 Element 的图片预览看大图，大图里导出的就是这张。等加载、生成、失败都写在预览下面那一行。浮层关上时放弃没完成的导出、
 * 关掉大图
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
    done: () => true,
    /** 大图预览开着时是关掉它的函数，关上时是 null：页面交给浮层的 hold，Esc 只关大图 */
    viewer: (closeLayer: (() => void) | null) => closeLayer === null || typeof closeLayer === 'function'
  },
  setup(props, { emit }) {
    const map = useMap();
    const canvas = ref<HTMLCanvasElement>();
    const thumbnail = ref<HTMLButtonElement>();
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
    // 这一次生成是要保存还是看大图：保存时"导出"转圈
    const pending = ref<'save' | 'view' | null>(null);
    // 大图预览的图片：生成的结果和它的地址，关掉时释放
    const viewed = shallowRef<{ readonly result: PrintResult; readonly url: string; readonly moved: string } | null>(
      null
    );
    let alive = true;
    onScopeDispose(() => (alive = false));

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

    // 按截下的画面和现在的标题、图例位置合成预览
    const compose = () => {
      if (!captured) {
        show(null);
        return;
      }
      try {
        const { snapshot, blocks } = captured.capture;
        show(composePrintImage(snapshot, blocks, props.settings.legend, printTitle(props.settings)));
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
    // 改标题、标题的位置：只按截下的重新合成
    watch(
      () => [props.settings.title, props.settings.titlePlacement] as const,
      () => compose(),
      { flush: 'post' }
    );

    const update = (patch: Partial<PrintSettings>) => emit('update:settings', { ...props.settings, ...patch });

    // 按现在的设置生成导出的那张图：保存和看大图共用，大图显示的就是导出的图
    const produce = async (kind: 'save' | 'view') => {
      pending.value = kind;
      try {
        const double = props.settings.double && doubleUsable.value;
        return await props.print.run({ ...props.settings, double });
      } finally {
        pending.value = null;
      }
    };

    const save = (result: PrintResult, moved: string) => {
      saveFile({ blob: result.blob, fileName: result.fileName });
      ElMessage.success(`已导出 ${result.fileName}${moved}`);
      emit('done');
    };

    const closeViewer = () => {
      const current = viewed.value;
      if (!current) {
        return;
      }
      URL.revokeObjectURL(current.url);
      viewed.value = null;
      emit('viewer', null);
    };

    // 用户关掉大图（Esc、遮罩、关闭按钮）：焦点回到预览。等大图卸下再给：它的 FocusTrap 卸载时会把焦点放回打开前的元素
    // （生成时预览不能点，Chromium 里是 body）
    const dismissViewer = () => {
      closeViewer();
      void nextTick(() => thumbnail.value?.focus({ preventScroll: true }));
    };

    // 浮层关上（还在淡出、没卸载）时就放弃没完成的导出、关掉大图：淡出的这段时间里晚到的结果不再弹出大图
    watch(
      () => props.active,
      active => {
        if (!active) {
          props.print.cancel();
          closeViewer();
        }
      }
    );

    const exportImage = async () => {
      const requested = props.settings.legend;
      const result = await produce('save');
      if (result && alive && props.active) {
        save(result, movedText(requested, result));
      }
    };

    // 浮层在生成的时候关上了：结果不再显示
    const openViewer = async () => {
      const requested = props.settings.legend;
      const result = await produce('view');
      if (!result || !alive || !props.active) {
        return;
      }
      viewed.value = { result, url: URL.createObjectURL(result.blob), moved: movedText(requested, result) };
      emit('viewer', dismissViewer);
    };

    // 先关大图、等它卸下（FocusTrap 会移动焦点），再保存、让页面关浮层，焦点回到入口
    const exportViewed = async () => {
      const current = viewed.value;
      if (!current) {
        return;
      }
      closeViewer();
      await nextTick();
      save(current.result, current.moved);
    };

    onBeforeUnmount(() => {
      closeViewer();
      props.print.cancel();
    });
    onScopeDispose(() => capturing?.abort());

    // 预览下面那一行：平时是导出的像素；导出、看大图时是等加载（可以不等了）和生成；失败时是原因
    const renderStatus = () => {
      const phase = props.print.phase.value;
      if (phase === 'waiting') {
        return (
          <div class={styles.status} data-print-waiting>
            <ElIcon class="is-loading">
              <Loading />
            </ElIcon>
            等待地图加载完成
            <ElButton link type="primary" size="small" onClick={() => props.print.skipWait()}>
              不等了
            </ElButton>
          </div>
        );
      }
      if (phase === 'composing') {
        return (
          <div class={styles.status}>
            <ElIcon class="is-loading">
              <Loading />
            </ElIcon>
            正在生成图片
          </div>
        );
      }
      const error = props.print.error.value;
      if (error !== '') {
        return (
          <div class={[styles.status, styles.error]} role="alert">
            <SvgIcon name="status-warning" size={14} />
            <span>{error}</span>
          </div>
        );
      }
      const size = exportSize.value;
      return (
        <div class={styles.status}>
          {size && (
            <span data-print-size>
              {size[0]} × {size[1]} 像素
            </span>
          )}
        </div>
      );
    };

    // 大图预览：Element 的图片预览，工具栏只留缩放、原始大小和导出（转动对导出没有意义）
    const renderViewer = () => {
      const current = viewed.value;
      if (!current) {
        return null;
      }
      const { width, height } = current.result;
      return (
        <ElImageViewer
          urlList={[current.url]}
          hideOnClickModal
          teleported
          // Esc 由浮层在捕获阶段截住、交给 dismissViewer，不让大图自己在冒泡阶段处理（页面上别的 Esc 监听会一起收到）
          closeOnPressEscape={false}
          onClose={dismissViewer}
        >
          {{
            progress: () => [
              <span class={styles.viewerInfo} data-print-viewer-info>
                打印预览：{width} × {height} 像素{current.moved}
              </span>
            ],
            toolbar: ({ actions, reset }: ViewerToolbar) => [
              viewerButton('缩小', <ZoomOut />, () => actions('zoomOut')),
              viewerButton('放大', <ZoomIn />, () => actions('zoomIn')),
              <span class={styles.viewerGap} />,
              viewerButton('原始大小、适应窗口', <ScaleToOriginal />, reset),
              <span class={styles.viewerGap} />,
              <button
                type="button"
                class={[styles.viewerButton, styles.viewerExport]}
                onKeydown={keepSpace}
                onClick={() => void exportViewed()}
              >
                <ElIcon size={18}>
                  <Download />
                </ElIcon>
                导出
              </button>
            ]
          }}
        </ElImageViewer>
      );
    };

    return () => {
      const busy = props.print.phase.value !== 'idle';
      const note = previewError.value || (image.value ? '' : '等待地图加载完成');
      return (
        <MxPanel floating headerTone="muted" title="地图打印" data-map-print>
          {{
            actions: () => [
              <ElButton
                link
                type="primary"
                icon={Download}
                loading={pending.value === 'save'}
                disabled={busy}
                onClick={() => void exportImage()}
              >
                导出
              </ElButton>
            ],
            default: () => [
              <div class={styles.body}>
                <button
                  ref={thumbnail}
                  type="button"
                  class={styles.preview}
                  disabled={note !== '' || busy}
                  // 没截到图时说明放进名称：按钮的名称取 aria-label，里面的文字读屏读不到
                  aria-label={note === '' ? '查看打印预览的大图' : `打印预览：${note}`}
                  data-print-preview
                  onClick={() => void openViewer()}
                >
                  <canvas ref={canvas} class={[styles.image, note !== '' && styles.hidden]} aria-hidden="true" />
                  {note !== '' && <span class={styles.empty}>{note}</span>}
                  {note === '' && (
                    <span class={styles.zoom} aria-hidden="true">
                      <SvgIcon name="status-zoom" size={14} />
                      查看大图
                    </span>
                  )}
                </button>
                {renderStatus()}
                <div class={styles.field}>
                  <span class={styles.label}>标题</span>
                  <ElInput
                    size="small"
                    clearable
                    maxlength={TITLE_MAX_LENGTH}
                    placeholder="无标题"
                    aria-label="标题"
                    disabled={busy}
                    modelValue={props.settings.title}
                    onUpdate:modelValue={(value: string) => update({ title: value })}
                  />
                </div>
                <div class={styles.field}>
                  <span class={styles.label}>位置</span>
                  <ElRadioGroup
                    class="radio-group-block"
                    size="small"
                    aria-label="标题的位置"
                    disabled={busy || printTitle(props.settings) === null}
                    modelValue={props.settings.titlePlacement}
                    onUpdate:modelValue={value => {
                      const placement = TITLE_PLACEMENTS.find(item => item.id === value);
                      if (placement) {
                        update({ titlePlacement: placement.id });
                      }
                    }}
                  >
                    {TITLE_PLACEMENTS.map(item => (
                      <ElRadioButton key={item.id} value={item.id}>
                        {item.label}
                      </ElRadioButton>
                    ))}
                  </ElRadioGroup>
                </div>
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
                    {/* 按钮自己的 disabled 会盖过组的，导出时也要禁用 */}
                    <ElRadioButton value="double" disabled={busy || !doubleUsable.value}>
                      2 倍
                    </ElRadioButton>
                  </ElRadioGroup>
                </div>
                {!doubleUsable.value && (
                  <div class={styles.note}>
                    {props.dimension === '3d' ? '三维只能同屏幕的清晰度' : '屏幕已经是 2 倍的清晰度'}
                  </div>
                )}
                {renderViewer()}
              </div>
            ]
          }}
        </MxPanel>
      );
    };
  }
});
