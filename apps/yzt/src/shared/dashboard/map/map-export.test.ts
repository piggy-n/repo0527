// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IndicatorMeta } from '../model';
import { drawMapLabels } from './map-export';
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
