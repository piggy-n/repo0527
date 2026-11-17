import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { required } from '../../testing/required';
import { imageWithTitle, saveImage, waitForExportFonts } from '../export/image-export';
import { renderChartImage } from './chart-export';
import type { DashboardChartOption } from './options';
import { cardPlotSize, useChartDownload, type ChartDownloadRequest } from './useChartDownload';

// jsdom 没有画布：出图、加标题、保存都换成记录调用的假函数，等字体由用例控制
vi.mock('./chart-export', () => ({ renderChartImage: vi.fn<typeof renderChartImage>() }));
vi.mock('../export/image-export', async importOriginal => ({
  ...await importOriginal<typeof import('../export/image-export')>(),
  waitForExportFonts: vi.fn<typeof waitForExportFonts>(),
  imageWithTitle: vi.fn<typeof imageWithTitle>(),
  saveImage: vi.fn<typeof saveImage>()
}));

const OPTION: DashboardChartOption = { series: [] };
const BLOB = new Blob(['png'], { type: 'image/png' });
const plotCanvas = document.createElement('canvas');

function request(overrides: Partial<ChartDownloadRequest> = {}): ChartDownloadRequest {
  return {
    indicator: { id: 'B-01', name: '人均公园绿地面积', unit: '平方米' },
    years: [2025, 2026],
    detail: false,
    option: OPTION,
    size: { width: 420, height: 240 },
    ...overrides
  };
}

function createDownloads() {
  const scope = effectScope();
  const downloads = required(scope.run(useChartDownload), '图表下载');
  return { scope, downloads };
}

/** 等字体停在这里，直到用例调用返回的函数 */
function holdFonts(): () => void {
  let release: (() => void) | undefined;
  vi.mocked(waitForExportFonts).mockImplementation(() => new Promise<void>(resolve => (release = resolve)));
  return () => required(release, '等字体的回调')();
}

beforeEach(() => {
  vi.mocked(waitForExportFonts).mockResolvedValue(undefined);
  vi.mocked(renderChartImage).mockReturnValue(plotCanvas);
  vi.mocked(imageWithTitle).mockImplementation(() => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'toBlob').mockImplementation(callback => callback(BLOB));
    return canvas;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useChartDownload', () => {
  it('卡片和详情的图按给定尺寸出图，标题带单位，文件名是「年份-指标名[-详情]」', async () => {
    const { scope, downloads } = createDownloads();
    await downloads.download(request({ size: { width: 0, height: 300 } }));
    expect(renderChartImage).toHaveBeenCalledWith(OPTION, 1, 300);
    expect(imageWithTitle).toHaveBeenCalledWith(plotCanvas, '人均公园绿地面积（平方米）');
    expect(saveImage).toHaveBeenLastCalledWith(BLOB, '2025-2026-人均公园绿地面积');
    await downloads.download(request({
      indicator: { id: 'I01', name: '生活宜居便利性指数', unit: '' },
      years: [2025],
      detail: true,
      size: { width: 780, height: 440 }
    }));
    expect(renderChartImage).toHaveBeenLastCalledWith(OPTION, 780, 440);
    expect(imageWithTitle).toHaveBeenLastCalledWith(plotCanvas, '生活宜居便利性指数');
    expect(saveImage).toHaveBeenLastCalledWith(BLOB, '2025-生活宜居便利性指数-详情');
    expect(saveImage).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it('没有图表配置时不下载', async () => {
    const { scope, downloads } = createDownloads();
    await downloads.download(request({ option: null }));
    expect(renderChartImage).not.toHaveBeenCalled();
    expect(saveImage).not.toHaveBeenCalled();
    scope.stop();
  });

  it('同一张图下载中再点只下载一次，卡片和详情分别计', async () => {
    const { scope, downloads } = createDownloads();
    const release = holdFonts();
    const first = downloads.download(request());
    expect(downloads.pending('B-01', false)).toBe(true);
    expect(downloads.pending('B-01', true)).toBe(false);
    await downloads.download(request());
    release();
    await first;
    expect(renderChartImage).toHaveBeenCalledTimes(1);
    expect(saveImage).toHaveBeenCalledTimes(1);
    expect(downloads.pending('B-01', false)).toBe(false);
    scope.stop();
  });

  it('卸载后晚到的结果不保存，也不再开始新的下载', async () => {
    const { scope, downloads } = createDownloads();
    const release = holdFonts();
    const started = downloads.download(request());
    scope.stop();
    release();
    await started;
    expect(saveImage).not.toHaveBeenCalled();
    expect(downloads.error.value).toBe('');
    await downloads.download(request({ detail: true }));
    expect(waitForExportFonts).toHaveBeenCalledTimes(1);
    expect(saveImage).not.toHaveBeenCalled();
  });

  it('失败时给出原因，再点可以重试', async () => {
    const { scope, downloads } = createDownloads();
    vi.mocked(renderChartImage).mockImplementationOnce(() => {
      throw new Error('图表导出画布不可用');
    });
    await downloads.download(request());
    expect(downloads.error.value).toBe('图表导出画布不可用');
    expect(saveImage).not.toHaveBeenCalled();
    await downloads.download(request());
    expect(downloads.error.value).toBe('');
    expect(saveImage).toHaveBeenCalledTimes(1);
    scope.stop();
  });
});

// 卡片外壳和绘图区的最小结构，jsdom 不排版，尺寸直接给出
function card(id: string, width: number, height: number): HTMLElement {
  const article = document.createElement('article');
  article.dataset.chartId = id;
  const plot = document.createElement('div');
  plot.setAttribute('role', 'img');
  Object.defineProperty(plot, 'clientWidth', { value: width });
  Object.defineProperty(plot, 'clientHeight', { value: height });
  article.append(plot);
  return article;
}

describe('cardPlotSize', () => {
  it('取卡片列表里这张卡绘图区的尺寸，找不到时用 420×240', () => {
    const list = document.createElement('div');
    list.append(card('B-01', 380, 210), card('B-02', 400, 220));
    expect(cardPlotSize(list, 'B-02')).toEqual({ width: 400, height: 220 });
    expect(cardPlotSize(list, 'B-03')).toEqual({ width: 420, height: 240 });
    expect(cardPlotSize(undefined, 'B-01')).toEqual({ width: 420, height: 240 });
  });
});
