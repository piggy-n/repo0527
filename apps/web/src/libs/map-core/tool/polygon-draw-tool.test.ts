// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { LngLat, MapPointerEvent } from '../view/view-input';
import { drawnPolygon, PolygonDrawTool, type PolygonDrawOptions } from './polygon-draw-tool';
import type { ToolView } from './tool-model';

const triangle: LngLat[] = [[119, 33], [119.1, 33], [119, 33.1]];
const view: ToolView = {
  kind: '2d',
  pick: ({ x, y }) => ({ kind: 'hit', lngLat: [119 + x / 100, 33 + y / 100], surface: 'map' }),
  project: () => null,
  queryRendered: () => []
};
const event = (type: MapPointerEvent['type'], x: number, y: number, clickCount = 1): MapPointerEvent => ({
  type, point: { x, y }, button: 0, clickCount, modifiers: { ctrl: false, meta: false, shift: false, alt: false }
});
function setup(kind: 'rectangle' | 'polygon') {
  const change = vi.fn<PolygonDrawOptions['change']>();
  const complete = vi.fn<PolygonDrawOptions['complete']>();
  const invalid = vi.fn<PolygonDrawOptions['invalid']>();
  const tool = new PolygonDrawTool({ kind, panModifier: 'ctrl', change, complete, invalid });
  return { tool, change, complete, invalid };
}

describe('范围绘制', () => {
  it('闭合有效多边形；拒绝不足三点、退化、自交和超过上限', () => {
    expect(drawnPolygon(triangle).coordinates).toEqual([[...triangle, triangle[0]]]);
    expect(() => drawnPolygon(triangle.slice(0, 2))).toThrow('3～120');
    expect(() => drawnPolygon([[119, 33], [119, 33], [119, 33]])).toThrow('范围过小');
    expect(() => drawnPolygon([[119, 33], [120, 34], [120, 33], [119, 34]])).toThrow('不能交叉');
    expect(() => drawnPolygon(Array.from({ length: 121 }, () => triangle[0]))).toThrow('3～120');
  });

  it('矩形松手即可完成，微小拖动不生成范围；离开后松手不沿用旧起点', () => {
    const { tool, complete, invalid } = setup('rectangle');
    tool.handleInput(event('down', 0, 0), view);
    tool.handleInput(event('up', 10, 10), view);
    expect(complete).toHaveBeenCalledWith({
      type: 'Polygon', coordinates: [[[119, 33], [119.1, 33], [119.1, 33.1], [119, 33.1], [119, 33]]]
    });
    tool.handleInput(event('down', 0, 0), view);
    tool.handleInput(event('up', 2, 2), view);
    expect(invalid).toHaveBeenCalledWith('范围过小，请拖动绘制范围');
    tool.handleInput(event('down', 0, 0), view);
    tool.handleInput(event('leave', 10, 10), view);
    tool.handleInput(event('up', 10, 10), view);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('多边形支持退格与回车，双击第二次 click 不重复加点，退出清空草稿', () => {
    const { tool, complete, change } = setup('polygon');
    tool.handleInput(event('click', 0, 0), view);
    tool.handleInput(event('click', 10, 0), view);
    tool.handleInput(event('click', 30, 0), view);
    tool.handleInput({ type: 'key', key: 'Backspace' }, view);
    tool.handleInput(event('click', 0, 10), view);
    tool.handleInput(event('click', 0, 10, 2), view);
    tool.handleInput({ type: 'key', key: 'Enter' }, view);
    expect(complete).toHaveBeenCalledWith(drawnPolygon(triangle));
    expect(change).toHaveBeenLastCalledWith([]);
    tool.handleInput(event('click', 1, 1), view);
    tool.deactivate();
    tool.handleInput({ type: 'key', key: 'Enter' }, view);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('矩形拾取失败后结束手势，不在下一次移动中恢复旧范围', () => {
    const { tool, complete } = setup('rectangle');
    tool.handleInput(event('down', 0, 0), view);
    tool.handleInput(event('up', 10, 10), { ...view, pick: () => ({ kind: 'miss' }) });
    tool.handleInput(event('up', 20, 20), view);
    expect(complete).not.toHaveBeenCalled();
  });
});
