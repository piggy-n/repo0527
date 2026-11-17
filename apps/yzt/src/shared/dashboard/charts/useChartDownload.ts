import { computed } from 'vue';
import { imageWithTitle, saveImage } from '../export/image-export';
import { useImageExport } from '../export/useImageExport';
import { withUnit } from '../format';
import type { IndicatorMeta } from '../model';
import { renderChartImage } from './chart-export';
import type { DashboardChartOption } from './options';
import type { ChartSize } from './useChartDetail';

/** 卡片绘图区取不到时的图片尺寸 */
const FALLBACK_CARD_SIZE: ChartSize = { width: 420, height: 240 };

export interface ChartDownloadRequest {
  /** 标题是 withUnit(名称, 单位)，文件名是「{年份}-{名称}」，按 id 防重复 */
  readonly indicator: Pick<IndicatorMeta, 'id' | 'name' | 'unit'>;
  /** 文件名开头的比较年份，多个年份用 - 连接 */
  readonly years: readonly number[];
  /** 详情里的图，文件名末尾加「-详情」 */
  readonly detail: boolean;
  /** 点击时的图表配置，没有时不下载 */
  readonly option: DashboardChartOption | null | undefined;
  /** 图片尺寸（CSS 像素），卡片用 cardPlotSize，详情用详情的图表区尺寸 */
  readonly size: ChartSize;
}

/** 卡片列表里某张卡（data-chart-id）绘图区的尺寸，与屏幕上的卡片一致 */
export function cardPlotSize(list: ParentNode | null | undefined, id: string): ChartSize {
  const cards = [...list?.querySelectorAll<HTMLElement>('[data-chart-id]') ?? []];
  const card = cards.find(item => item.dataset.chartId === id);
  const plot = card?.querySelector<HTMLElement>('[role="img"]');
  return {
    width: plot?.clientWidth ?? FALLBACK_CARD_SIZE.width,
    height: plot?.clientHeight ?? FALLBACK_CARD_SIZE.height
  };
}

// 同一指标的卡片和详情分别防重复
function exportKey(id: string, detail: boolean): string {
  return `${detail ? 'detail' : 'card'}:${id}`;
}

/** 图表下载：等字体、按固定配置另画一张带标题的图再保存；同一张图进行中时再点无效，卸载后不再保存 */
export function useChartDownload() {
  const exporting = useImageExport();

  /** 这张图正在下载，按钮应停用 */
  function pending(id: string, detail: boolean): boolean {
    return exporting.pending.value.has(exportKey(id, detail));
  }

  async function download({ indicator, years, detail, option, size }: ChartDownloadRequest): Promise<void> {
    if (!option) {
      return;
    }
    const title = withUnit(indicator.name, indicator.unit);
    const fileName = `${years.join('-')}-${indicator.name}${detail ? '-详情' : ''}`;
    const blob = await exporting.run(exportKey(indicator.id, detail), async signal => {
      await exporting.waitForFonts(signal);
      return imageWithTitle(renderChartImage(option, Math.max(1, size.width), Math.max(1, size.height)), title);
    });
    if (blob) {
      saveImage(blob, fileName);
    }
  }

  return { error: computed(() => exporting.error.value), pending, download };
}
