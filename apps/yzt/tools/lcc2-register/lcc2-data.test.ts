// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseIndex, parsePoses, samplePath } from './lcc2-data.ts';

const INDEX = {
  version: '0.0.3',
  epsg: 4548,
  offset: [505745.458968483, 3793605.533563799, 59.739105],
  shift: [0, 0, 0],
  root: { id: '0', boundingBox: { min: [-1, -2, -3], max: [4, 5, 6] }, childNum: 0 }
};

describe('parseIndex', () => {
  it('取 epsg、offset、根节点的包围盒，其余字段不管', () => {
    expect(parseIndex(JSON.stringify(INDEX))).toEqual({
      epsg: 4548,
      offset: INDEX.offset,
      root: { boundingBox: INDEX.root.boundingBox }
    });
  });

  it('开头的 BOM 去掉', () => {
    expect(parseIndex(`\uFEFF${JSON.stringify(INDEX)}`).epsg).toBe(4548);
  });

  it('缺 offset 报错', () => {
    expect(() => parseIndex(JSON.stringify({ ...INDEX, offset: undefined }))).toThrow('offset');
  });
});

const pose = (x: number) => ({ ts: '1', T: [x, 0, 0], R: [0, 0, 0, 1], RGB: null });

describe('parsePoses', () => {
  it('一次扫描：poses', () => {
    expect(parsePoses(JSON.stringify({ poses: [pose(1), pose(2)], fusionPoses: null }))).toEqual([
      [1, 0, 0],
      [2, 0, 0]
    ]);
  });

  it('几次扫描拼起来：fusionPoses 每次一组，按顺序拼在一起', () => {
    const text = JSON.stringify({ poses: null, fusionPoses: [[pose(1)], [pose(2), pose(3)]] });
    expect(parsePoses(text).map((point) => point[0])).toEqual([1, 2, 3]);
  });

  it('没有轨迹点报错', () => {
    expect(() => parsePoses(JSON.stringify({ poses: null, fusionPoses: null }))).toThrow('没有轨迹点');
  });
});

describe('samplePath', () => {
  it('相邻的取样点至少隔 spacing 米，第一个点总是留下', () => {
    const points = Array.from({ length: 21 }, (_, index) => [index * 0.1, 0, 0] as const);
    expect(samplePath(points, 0.5).map((point) => Number(point[0].toFixed(1)))).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it('原地不动的点只留一个', () => {
    const points = Array.from({ length: 10 }, () => [1, 1, 1] as const);
    expect(samplePath(points, 0.5)).toHaveLength(1);
  });
});
