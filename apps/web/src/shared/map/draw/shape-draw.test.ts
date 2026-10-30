// @vitest-environment node
import type { FeatureCollection } from 'geojson';
import { describe, expect, it } from 'vitest';
import { drawGroup, drawHintLines, type DrawnShape, polygonOf } from './shape-draw';

const CTRL = { modifier: 'ctrl', label: 'Ctrl' } as const;

const SHAPE: DrawnShape = {
  kind: 'polygon',
  polygon: polygonOf([
    [118, 32],
    [119, 32],
    [119, 33]
  ]),
  pixelSize: 0.001
};

// 分组里唯一的数据源的要素
function featuresOf(group: ReturnType<typeof drawGroup>) {
  const source = group.sources.draw;
  if (source?.type !== 'geojson') {
    throw new Error('没有 draw 数据源');
  }
  return (source.data as FeatureCollection).features;
}

describe('polygonOf', () => {
  it('节点连成闭合的环', () => {
    expect(SHAPE.polygon).toStrictEqual({
      type: 'Polygon',
      coordinates: [
        [
          [118, 32],
          [119, 32],
          [119, 33],
          [118, 32]
        ]
      ]
    });
  });
});

describe('drawHintLines', () => {
  it('框选：没按下时写出临时拖动的键，拖动中只提示松开完成', () => {
    expect(drawHintLines('rectangle', 0, CTRL)).toStrictEqual([
      '按下鼠标左键并拖动，绘制矩形范围',
      '按住 Ctrl 拖动地图，Esc 退出'
    ]);
    expect(drawHintLines('rectangle', 1, CTRL)).toStrictEqual(['拖动调整框选范围，松开鼠标完成绘制']);
  });

  it('多边形：按已画的节点数提示下一步', () => {
    expect(drawHintLines('polygon', 0, CTRL)[0]).toBe('单击绘制首个节点');
    expect(drawHintLines('polygon', 1, CTRL)[0]).toBe('单击继续绘制第二个节点');
    expect(drawHintLines('polygon', 4, CTRL)[0]).toBe('单击继续绘制下一个节点，双击结束绘制');
  });
});

describe('drawGroup', () => {
  it('没有范围也没在画时是空分组', () => {
    expect(drawGroup(null, null)).toStrictEqual({ sources: {}, layers: [] });
  });

  it('画完的范围是 completed 的面，图层 ID 以分组名开头', () => {
    const group = drawGroup(SHAPE, null);

    expect(featuresOf(group)).toStrictEqual([
      { type: 'Feature', properties: { status: 'completed' }, geometry: SHAPE.polygon }
    ]);
    expect(group.layers.every(layer => layer.id.startsWith('draw-'))).toBe(true);
  });

  it('画的过程中：一个节点只有节点；加上预览点够三个点时虚线闭合', () => {
    expect(featuresOf(drawGroup(null, { points: [[118, 32]], preview: null })).map(feature => feature.properties))
      .toStrictEqual([{ status: 'vertex' }]);

    const features = featuresOf(
      drawGroup(null, {
        points: [
          [118, 32],
          [119, 32]
        ],
        preview: [119, 33]
      })
    );
    expect(features[0]).toMatchObject({
      properties: { status: 'drawing' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [118, 32],
          [119, 32],
          [119, 33],
          [118, 32]
        ]
      }
    });
    expect(features.filter(feature => feature.properties?.status === 'vertex')).toHaveLength(2);
  });
});
