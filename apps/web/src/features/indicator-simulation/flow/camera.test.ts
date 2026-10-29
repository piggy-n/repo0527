// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { flowCamera } from './camera';
import type { FlowFrame } from './frame';
import { FLOW_LAYOUT, type FlowNode, type FlowPlan } from './plan';

const node = (key: string, column: number, y: number): FlowNode => ({
  key,
  step: 'spatial',
  column,
  label: '',
  title: '',
  detail: '',
  kind: 'node',
  scenario: false,
  fail: false,
  x: FLOW_LAYOUT.padX + column * (FLOW_LAYOUT.nodeWidth + FLOW_LAYOUT.columnGap),
  y
});
const plan = (width: number, height: number, nodes: FlowNode[] = []): FlowPlan => ({
  nodes,
  edges: [],
  lines: [],
  summaries: { parse: '', prep: '', qc: '', spatial: '', compute: '', evaluate: '', report: '' },
  width,
  height
});
const frame = (column: number | null, running: string[] = []): FlowFrame => ({
  column,
  nodes: new Map(running.map(key => [key, { status: 'running', progress: 0.5 }]))
});

describe('flowCamera', () => {
  it('全览：缩放到放下整棵树并居中，底部给卡片留位置；最小 0.6，不放大', () => {
    expect(flowCamera(plan(1000, 400), frame(null), { width: 1024, height: 600, bottom: 0 }, 'overview')).toEqual({
      scale: 1,
      x: 12,
      y: 100
    });
    const fit = flowCamera(plan(1500, 500), frame(null), { width: 1080, height: 600, bottom: 84 }, 'overview');
    expect(fit.scale).toBeCloseTo(1056 / 1500, 6);
    expect(fit.x).toBeCloseTo((1080 - 1500 * fit.scale) / 2, 6);
    expect(flowCamera(plan(3000, 500), frame(null), { width: 800, height: 600, bottom: 0 }, 'overview').scale).toBe(0.6);
  });

  it('跟随：放得下时居中；横向放不下时正在执行的一列在六成处，两端不露空白', () => {
    expect(flowCamera(plan(1000, 400), frame(3), { width: 1200, height: 600, bottom: 0 }, 'follow')).toEqual({
      scale: 1,
      x: 100,
      y: 100
    });
    const focus = FLOW_LAYOUT.padX + 3 * (FLOW_LAYOUT.nodeWidth + FLOW_LAYOUT.columnGap) + FLOW_LAYOUT.nodeWidth / 2;
    expect(flowCamera(plan(1500, 400), frame(3), { width: 900, height: 600, bottom: 0 }, 'follow').x).toBe(540 - focus);
    // 第一列时不往右移出空白，最后一列时不往左露出空白
    expect(flowCamera(plan(1500, 400), frame(0), { width: 900, height: 600, bottom: 0 }, 'follow').x).toBe(0);
    expect(flowCamera(plan(1500, 400), frame(6), { width: 900, height: 600, bottom: 0 }, 'follow').x).toBe(-600);
  });

  it('跟随：纵向放不下时让进行中的节点在中间', () => {
    const tall = plan(800, 1000, [node('a', 3, 400), node('b', 3, 500)]);
    const camera = flowCamera(tall, frame(3, ['a', 'b']), { width: 900, height: 500, bottom: 0 }, 'follow');
    const middle = (400 + 500) / 2 + FLOW_LAYOUT.nodeHeight / 2;
    expect(camera.y).toBe(250 - middle);
    expect(flowCamera(tall, frame(3), { width: 900, height: 500, bottom: 0 }, 'follow').y).toBe(0);
  });
});
