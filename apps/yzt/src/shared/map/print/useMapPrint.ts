import type { MapSnapshot } from '@mx/map-core';
import type { MapContext, MapViewport } from '@mx/map-vue';
import { onScopeDispose, type Ref, ref } from 'vue';
import { canvasBlob } from '../../file-transfer';
import { printFileName } from './print-file-name';
import {
  composePrintImage,
  LEGEND_FONTS,
  type LegendPlacement,
  type PrintTitle,
  type TitlePlacement
} from './print-image';
import type { PrintLegendBlock } from './print-legend';

/** 导出的设置（ADR 0174） */
export interface PrintSettings {
  readonly legend: LegendPlacement;
  /** 二维按 2 倍的像素比截图；三维照屏幕（模型按屏幕误差选精度） */
  readonly double: boolean;
  /** 标题（用户 2026-11-25）：去掉首尾空白后为空时不带 */
  readonly title: string;
  readonly titlePlacement: TitlePlacement;
}

/** 默认的设置；标题的默认值由页面给（现状底图是系统名） */
export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  legend: 'side',
  double: false,
  title: '',
  titlePlacement: 'header'
};

/** 设置里要画的标题：去掉首尾空白后为空时不带 */
export function printTitle(settings: Pick<PrintSettings, 'title' | 'titlePlacement'>): PrintTitle | null {
  const text = settings.title.trim();
  return text === '' ? null : { text, placement: settings.titlePlacement };
}

export interface MapPrintOptions {
  /** 文件名的开头，如"现状底图" */
  readonly name: string;
  /** 截图那一帧不画的分组：测量、选中高亮这些临时的标记（用户 2026-11-24） */
  readonly omitGroups: readonly string[];
  /**
   * 截图这一刻的图例，从上到下：拿到就绪的视图和地图的 CSS 尺寸，可以整屏查画出来的要素；在截图之后同步调用，
   * 和截下的画面是同一个状态
   */
  readonly legend: (view: MapViewport, size: { readonly width: number; readonly height: number }) => PrintLegendBlock[];
}

/** 截下的画面和这一刻的图例；不带图例时没有查，是空的 */
export interface PrintCapture {
  readonly snapshot: MapSnapshot;
  readonly blocks: readonly PrintLegendBlock[];
}

/** 空闲、等地图加载完、截图和合成 */
export type PrintPhase = 'idle' | 'waiting' | 'composing';

export interface PrintResult {
  readonly blob: Blob;
  readonly fileName: string;
  /** 图例实际放在哪里：右下角放不下时改到右侧 */
  readonly placement: LegendPlacement;
  /** 图片的像素 */
  readonly width: number;
  readonly height: number;
}

export interface MapPrint {
  readonly phase: Readonly<Ref<PrintPhase>>;
  /** 上一次导出失败的原因；开始新的导出时清空 */
  readonly error: Readonly<Ref<string>>;
  /**
   * 给预览用：等画面完整后按屏幕的像素比截一帧，legend 为 true 时紧接着推导图例（整屏查要素）。signal 中止、
   * 视图卸下、等完时正在导出都以 AbortError 结束；等完了没有就绪的视图时为 null
   */
  capture(legend: boolean, signal: AbortSignal): Promise<PrintCapture | null>;
  /**
   * 等到画面完整，截图、合成、编码：保存和大图预览共用，预览显示的就是导出的那张图。正在进行时、作用域销毁后返回 null，
   * 取消、失败也返回 null（失败时记下原因）
   */
  run(settings: PrintSettings): Promise<PrintResult | null>;
  /** 不再等加载，按当前画面导出 */
  skipWait(): void;
  /** 放弃正在进行的导出 */
  cancel(): void;
}

// 图例的文字用普惠体，页面一般已经加载了；缺字体时用后备字体，不挡住导出
async function fontsReady(): Promise<void> {
  const { fonts } = document;
  if (fonts) {
    await Promise.allSettled(Object.values(LEGEND_FONTS).map(font => fonts.load(font)));
  }
}

// 失败时给用户看的原因；不是这边取消的中止是等的时候换了视图、切换了二三维
function failureMessage(reason: unknown): string {
  if (reason instanceof DOMException && reason.name === 'AbortError') {
    return '地图在等待时发生了变化，请重新导出';
  }
  return reason instanceof Error ? reason.message : '导出失败，请重试';
}

/**
 * 地图打印（ADR 0174）：截图那一刻的画面加上图例、标题合成一张 PNG，交给调用方保存。组合式函数不保存、不提示，
 * 这些由组件决定；同一时间只有一次导出，作用域销毁时作废，晚到的结果不交出去
 */
export function useMapPrint(map: MapContext, options: MapPrintOptions): MapPrint {
  const phase = ref<PrintPhase>('idle');
  const error = ref('');
  let current: { readonly stop: AbortController; readonly skip: AbortController } | null = null;
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
    current?.stop.abort();
  });

  // 截一帧，紧接着推导这一刻的图例；不带图例时不查
  const captureOf = (view: MapViewport, legend: boolean, pixelRatio?: number): PrintCapture => {
    const snapshot = view.snapshot({ omitGroups: options.omitGroups, ...(pixelRatio ? { pixelRatio } : {}) });
    return { snapshot, blocks: legend ? options.legend(view, snapshot) : [] };
  };

  // 等到画面完整；"不等了"时直接往下走。视图卸下、切换二三维时照常以 AbortError 结束
  const waitComplete = async (stop: AbortSignal, skip: AbortSignal) => {
    const waiting = new AbortController();
    const end = () => waiting.abort();
    stop.addEventListener('abort', end);
    skip.addEventListener('abort', end);
    try {
      await map.whenComplete(waiting.signal);
    } catch (reason) {
      if (stop.aborted || !skip.aborted) {
        throw reason;
      }
    } finally {
      stop.removeEventListener('abort', end);
      skip.removeEventListener('abort', end);
    }
  };

  const run = async (settings: PrintSettings): Promise<PrintResult | null> => {
    if (disposed || current) {
      return null;
    }
    const operation = { stop: new AbortController(), skip: new AbortController() };
    const { signal } = operation.stop;
    current = operation;
    phase.value = 'waiting';
    error.value = '';
    try {
      await waitComplete(signal, operation.skip.signal);
      await fontsReady();
      signal.throwIfAborted();
      const view = map.view.value;
      if (!view) {
        throw new Error('地图还没有就绪，请稍后再导出');
      }
      phase.value = 'composing';
      const double = settings.double && view.kind === '2d';
      const { snapshot, blocks } = captureOf(view, settings.legend !== 'none', double ? 2 : undefined);
      const image = composePrintImage(snapshot, blocks, settings.legend, printTitle(settings));
      const blob = await canvasBlob(image.canvas);
      signal.throwIfAborted();
      const { width, height } = image.canvas;
      return { blob, fileName: printFileName(options.name, new Date()), placement: image.placement, width, height };
    } catch (reason) {
      if (!signal.aborted) {
        error.value = failureMessage(reason);
      }
      return null;
    } finally {
      if (current === operation) {
        current = null;
        phase.value = 'idle';
      }
    }
  };

  return {
    phase,
    error,
    capture: async (legend, signal) => {
      await map.whenComplete(signal);
      if (current) {
        throw new DOMException('正在导出，不截预览', 'AbortError');
      }
      const view = map.view.value;
      return view ? captureOf(view, legend) : null;
    },
    run,
    skipWait: () => current?.skip.abort(),
    cancel: () => current?.stop.abort()
  };
}
