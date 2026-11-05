// @vitest-environment node
import type { MultiPolygon } from 'geojson';
import type { LngLat, ScreenPoint } from '@mx/map-core';
import { describe, expect, it } from 'vitest';
import { editGroup, handleAt, handlesOf, insertVertex, moveVertex, removeVertex } from './shape-edit';

// 正方形 (0,0)-(10,10)，一个洞 (2,2)-(4,4)
const SQUARE: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0]
      ],
      [
        [2, 2],
        [4, 2],
        [4, 4],
        [2, 2]
      ]
    ]
  ]
};
// 1 度 = 10 像素
const project = ([lng, lat]: LngLat): ScreenPoint => ({ x: lng * 10, y: lat * 10 });

describe('shape-edit', () => {
  it('每个节点和每条边的中点各一个手柄，不含重复的首尾点', () => {
    const handles = handlesOf(SQUARE);
    expect(handles.filter(handle => handle.kind === 'vertex')).toHaveLength(7);
    expect(handles.filter(handle => handle.kind === 'middle')).toHaveLength(7);
    expect(handles[1]).toEqual({ kind: 'middle', ref: { part: 0, ring: 0, index: 0 }, position: [5, 0] });
  });

  it('按到的手柄：在半径以内的最近一个，节点和中点重叠时选节点', () => {
    const handles = handlesOf(SQUARE);
    expect(handleAt(handles, { x: 98, y: 3 }, project)?.ref).toEqual({ part: 0, ring: 0, index: 1 });
    expect(handleAt(handles, { x: 50, y: 4 }, project)?.kind).toBe('middle');
    expect(handleAt(handles, { x: 70, y: 50 }, project)).toBeNull();
    // 重叠的节点和中点
    const tiny: MultiPolygon = { type: 'MultiPolygon', coordinates: [[[[0, 0], [0.2, 0], [0.2, 0.2], [0, 0]]]] };
    expect(handleAt(handlesOf(tiny), { x: 1, y: 0 }, project)?.kind).toBe('vertex');
  });

  it('移动节点：第一个节点同时改首尾点，其余的环不变', () => {
    const moved = moveVertex(SQUARE, { part: 0, ring: 0, index: 0 }, [-1, -1]);
    expect(moved.coordinates[0]?.[0]).toEqual([[-1, -1], [10, 0], [10, 10], [0, 10], [-1, -1]]);
    expect(moved.coordinates[0]?.[1]).toBe(SQUARE.coordinates[0]?.[1]);
    expect(SQUARE.coordinates[0]?.[0]?.[0]).toEqual([0, 0]);
  });

  it('在边上插入节点，返回新节点的位置', () => {
    const { geometry, ref } = insertVertex(SQUARE, { part: 0, ring: 0, index: 3 }, [0, 5]);
    expect(geometry.coordinates[0]?.[0]).toEqual([[0, 0], [10, 0], [10, 10], [0, 10], [0, 5], [0, 0]]);
    expect(ref).toEqual({ part: 0, ring: 0, index: 4 });
  });

  it('删除节点；只剩 3 个节点的环不能再删', () => {
    const removed = removeVertex(SQUARE, { part: 0, ring: 0, index: 0 });
    expect(removed?.coordinates[0]?.[0]).toEqual([[10, 0], [10, 10], [0, 10], [10, 0]]);
    expect(removeVertex(SQUARE, { part: 0, ring: 1, index: 0 })).toBeNull();
    expect(removeVertex(SQUARE, { part: 3, ring: 0, index: 0 })).toBeNull();
  });

  it('样式分组：节点、中点，选中与悬停的标记，拖动时的范围；没有范围时为空', () => {
    expect(editGroup(null, { preview: null, hovered: null, selected: null }).layers).toEqual([]);
    const [hovered] = handlesOf(SQUARE);
    const group = editGroup(SQUARE, {
      preview: SQUARE,
      hovered: hovered ?? null,
      selected: { part: 0, ring: 0, index: 2 }
    });
    const source = group.sources['shape-edit'];
    const features = source?.type === 'geojson' && typeof source.data === 'object' && 'features' in source.data
      ? source.data.features
      : [];
    expect(features).toHaveLength(15);
    expect(features[0]?.properties).toEqual({ kind: 'preview' });
    expect(features.filter(feature => feature.properties?.selected === true)).toHaveLength(1);
    expect(features.filter(feature => feature.properties?.hovered === true)).toHaveLength(1);
  });
});
