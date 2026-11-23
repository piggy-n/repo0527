// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IndicatorMeta } from '../model';
import type { MapLegendLevel } from './config';
import type { ExportPart, ExportRoom } from './export-parts';
import { drawLegend, drawMapLabels, layoutMapImage, legendSize } from './map-export';
import type { DashboardMapSnapshot, MapLabel } from './types';

const indicator: Pick<IndicatorMeta, 'unit' | 'precision'> = { unit: '%', precision: 1 };

const label: MapLabel = {
  code: '320100',
  name: '南京市',
  x: 100,
  y: 80,
  anchorX: 100,
  anchorY: 80,
  halfWidth: 40,
  halfHeight: 25,
  connected: false
};

// 只记录写出的文字和位置、写字时的基线
function recordingSnapshot(values: DashboardMapSnapshot['values']) {
  const texts: { text: string; x: number; y: number; baseline: string }[] = [];
  const context = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'start',
    textBaseline: 'alphabetic',
    save() {
    },
    restore() {
    },
    scale() {
    },
    beginPath() {
    },
    moveTo() {
    },
    lineTo() {
    },
    stroke() {
    },
    strokeText() {
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, baseline: context.textBaseline });
    }
  };
  const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
  const snapshot: DashboardMapSnapshot = { canvas, labels: [label], values, simple: false, labelScale: 1 };
  return { snapshot, texts };
}

describe('drawMapLabels', () => {
  it('默认在名称下面写数值', () => {
    const { snapshot, texts } = recordingSnapshot({ 320100: 86.5 });
    drawMapLabels(snapshot, indicator);
    expect(texts).toEqual([
      { text: '南京市', x: 100, y: 68, baseline: 'alphabetic' },
      { text: '86.5%', x: 100, y: 87, baseline: 'alphabetic' }
    ]);
  });

  it('不显示数值时只写名称，画在标签中心', () => {
    const { snapshot, texts } = recordingSnapshot({ 320100: 86.5 });
    drawMapLabels(snapshot, indicator, false);
    expect(texts).toEqual([{ text: '南京市', x: 100, y: 80, baseline: 'middle' }]);
  });
});

// 每个字 10 像素宽，只记录写字和填充
function measuringContext() {
  const texts: { text: string; x: number; y: number }[] = [];
  const fills: string[] = [];
  const context = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'start',
    textBaseline: 'alphabetic',
    measureText: (text: string) => ({ width: text.length * 10 }),
    save() {
    },
    restore() {
    },
    beginPath() {
    },
    roundRect() {
    },
    stroke() {
    },
    fill() {
      fills.push(context.fillStyle);
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y });
    }
  };
  return { context: context as unknown as CanvasRenderingContext2D, texts, fills };
}

// 固定大小的叠加元素，记录排版时留给它的宽高
function fixedPart(width: number, height: number) {
  const rooms: ExportRoom[] = [];
  const part: ExportPart = {
    layout(_context, room) {
      rooms.push(room);
      return width <= room.width ? { width, height, draw() {
      } } : null;
    }
  };
  return { part, rooms };
}

const levels: MapLegendLevel[] = [
  { color: '#075BE7', label: '60% ~ 70%' },
  { color: '#B4E2FD', label: '20% ~ <60%' }
];

describe('导出地图图片的排版', () => {
  it('没有图例和叠加元素时同原来：标题栏下面就是地图，没有底栏，标题按宽度减 40 换行', () => {
    const { context } = measuringContext();
    const layout = layoutMapImage(context, {
      width: 200,
      height: 300,
      title: '一二三四五六七八九十一二三四五六七',
      legend: [],
      topRight: [],
      bottomRight: []
    });
    expect(layout.title.lines).toEqual(['一二三四五六七八九十一二三四五六', '七']);
    expect(layout).toMatchObject({ width: 200, height: 100 + 300, mapTop: 100, legend: null, parts: [] });
  });

  it('图例在地图下面的底栏左侧，比例尺在右侧底对齐，指北针在标题栏右侧居中，标题两侧让出指北针', () => {
    const { context } = measuringContext();
    const compass = fixedPart(48, 48);
    const scale = fixedPart(150, 30);
    const layout = layoutMapImage(context, {
      width: 600,
      height: 400,
      title: '标题',
      legend: levels,
      topRight: [compass.part],
      bottomRight: [scale.part]
    });
    expect(compass.rooms).toEqual([{ width: 48, height: 48 }]);
    // 图例宽：边框 2 + 内边距 20 + 色块 20 + 间距 8 + 最长文字 100；高：2 + 20 + 两行 46.2
    const legend = { width: 150, height: 69 };
    // 一行标题的标题栏高 66；底栏是图例和比例尺里高的那个，上下各留 12
    const height = 66 + 400 + legend.height + 24;
    // 比例尺至多 220 宽，不超过去掉两边 16 和图例、间距后的宽度
    expect(scale.rooms).toEqual([{ width: 220, height: Number.POSITIVE_INFINITY }]);
    expect(layout).toMatchObject({
      height,
      mapTop: 66,
      legend: { x: 16, y: height - 12 - legend.height, ...legend }
    });
    expect(layout.parts.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 600 - 16 - 48, y: 33 - 24 },
      { x: 600 - 16 - 150, y: height - 12 - 30 }
    ]);
  });

  it('指北针让出的宽度两侧都扣掉，标题照此换行', () => {
    const { context } = measuringContext();
    const title = '一二三四五六七八九十一二三四五六七八九十';
    const plain = layoutMapImage(context, { width: 300, height: 100, title, legend: [], topRight: [], bottomRight: [] });
    const withCompass = layoutMapImage(context, {
      width: 300,
      height: 100,
      title,
      legend: [],
      topRight: [fixedPart(48, 48).part],
      bottomRight: []
    });
    // 300 - 40 放得下 26 个字；300 - (48 + 16 + 8) × 2 只放得下 15 个
    expect(plain.title.lines).toHaveLength(1);
    expect(withCompass.title.lines.map(line => line.length)).toEqual([15, 5]);
  });

  it('比例尺放不下时不画，底栏只按图例的高度', () => {
    const { context } = measuringContext();
    const scale = fixedPart(150, 30);
    const layout = layoutMapImage(context, {
      width: 300,
      height: 100,
      title: '标题',
      legend: levels,
      topRight: [],
      bottomRight: [scale.part]
    });
    // 300 - 32 - (150 + 16) = 102
    expect(scale.rooms).toEqual([{ width: 102, height: Number.POSITIVE_INFINITY }]);
    expect(layout.parts).toEqual([]);
    expect(layout.height).toBe(66 + 100 + 69 + 24);
  });

  it('没有图例时底栏只放比例尺，高度取整到 CSS 像素', () => {
    const { context } = measuringContext();
    // 比例尺实际高 19.6 + 2 + 8
    const layout = layoutMapImage(context, {
      width: 600,
      height: 400,
      title: '标题',
      legend: [],
      topRight: [],
      bottomRight: [fixedPart(150, 29.6).part]
    });
    expect(layout.legend).toBeNull();
    expect(layout.height).toBe(66 + 400 + 30 + 24);
    expect(layout.parts[0]?.y).toBe(layout.height - 12 - 29.6);
  });
});

describe('导出图片的图例', () => {
  it('从上到下每档一个色块和文字，与页面上的顺序相同', () => {
    const { context, texts, fills } = measuringContext();
    drawLegend(context, levels, { x: 16, y: 500, width: 150, height: 69 });
    // 先填图例框，再依次填每档的色块
    expect(fills).toEqual(['rgba(207, 233, 254, 0.78)', '#075BE7', '#B4E2FD']);
    expect(texts).toEqual([
      { text: '60% ~ 70%', x: 16 + 1 + 10 + 20 + 8, y: 500 + 1 + 10 + 23.1 / 2 },
      { text: '20% ~ <60%', x: 16 + 1 + 10 + 20 + 8, y: 500 + 1 + 10 + 23.1 * 1.5 }
    ]);
  });

  it('没有档位时没有图例框', () => {
    expect(legendSize(measuringContext().context, [])).toBeNull();
  });
});
