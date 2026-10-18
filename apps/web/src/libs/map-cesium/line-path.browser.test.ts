import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { drawCanvas, prepareCanvasDrawing } from './canvas-renderer';
import { compileStylePlan } from './style-plan';

function context(): OffscreenCanvasRenderingContext2D {
  const result = new OffscreenCanvas(128, 128).getContext('2d');
  if (!result) { throw new Error('测试需要二维画布'); }
  return result;
}

function compare(paths: readonly number[][], closed: boolean, dash: number[], blur = 0, offset = 0, opacity = 1) {
  const specification: LayerSpecification = {
    id: 'line', type: 'line', source: 'data', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': 6, 'line-color': '#ff0000', 'line-dasharray': dash, 'line-offset': offset,
      'line-blur': blur, 'line-opacity': opacity }
  };
  const plan = compileStylePlan({
    version: 8, sources: { data: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } }, layers: [specification]
  });
  expect(plan.issues).toEqual([]);
  const type = closed ? 'Polygon' : 'LineString';
  const draw = prepareCanvasDrawing(plan.layers[0], { type, paths, feature: { type, properties: {} } }, 10);
  if (!draw) { throw new Error('测试需要线绘制器'); }
  const actual = context();
  drawCanvas(actual, draw, (x, y) => [x, y], 1);
  const reference = context();
  reference.beginPath();
  for (const path of paths) {
    reference.moveTo(path[0], path[1]);
    for (let index = 2; index < path.length; index += 2) { reference.lineTo(path[index], path[index + 1]); }
    if (closed) { reference.closePath(); }
  }
  if (offset !== 0) { reference.clip('evenodd'); }
  reference.lineWidth = offset === 0 ? 6 : 12;
  reference.lineCap = 'round';
  reference.lineJoin = 'round';
  reference.strokeStyle = '#ff0000';
  reference.globalAlpha = opacity;
  reference.setLineDash(dash.map(value => value * 6));
  reference.shadowColor = blur > 0 ? '#ff0000' : 'transparent';
  reference.shadowBlur = blur;
  reference.stroke();
  const expected = reference.getImageData(0, 0, 128, 128).data;
  const pixels = actual.getImageData(0, 0, 128, 128).data;
  const differences = pixels.map((value, index) => index % 4 === 3 ? Math.abs(value - expected[index]) : 0);
  const mismatches = [...differences].flatMap((value, index) => value > 2 ? [{
    x: Math.floor(index / 4) % 128, y: Math.floor(index / 4 / 128), actual: pixels[index], expected: expected[index]
  }] : []);
  expect(mismatches.slice(0, 8)).toEqual([]);
}

describe('线裁剪的真实像素契约', () => {
  it('跨边界虚线的正相位与原路径一致，转折和模糊不新增可见端点', () => {
    expect.hasAssertions();
    compare([[-301, 50, 50, 50, 90, 90, 300, 90]], false, [3, 2]);
    compare([[-301, 50, 50, 50, 90, 90, 300, 90]], false, [3, 2], 1);
  });

  it('闭合环的首尾与孔洞内收保持原始虚线相位', () => {
    expect.hasAssertions();
    compare([[32, 32, 301, 32, 301, 301, 32, 301, 32, 32]], true, [3, 2]);
    compare([[32, 32, 301, 32, 301, 301, 32, 301, 32, 32], [60, 60, 60, 200, 200, 200, 200, 60, 60, 60]], true, [3, 2], 0, 3);
  });

  it('奇数虚线周期、零长度点线和折点两侧的相位保持一致', () => {
    expect.hasAssertions();
    const path = [[-301, 50, 50, 50, 90, 90, 300, 90]];
    compare(path, false, [3, 2, 1]);
    compare(path, false, [0, 2]);
    compare(path, false, [3, 0, 1, 2]);
    compare(path, false, [0, 0, 2, 1]);
  });

  it('半透明自交与闭合起点只合成一次，不因分片增加透明度', () => {
    expect.hasAssertions();
    compare([[-301, 50, 200, 50, 200, 200, 32, 32, 32, 200, 200, 32]], false, [3, 2], 0, 0, 0.4);
    compare([[32, 32, 295, 32, 295, 295, 32, 295, 32, 32]], true, [3, 2], 0, 0, 0.4);
    compare([[32, 32, 301, 32, 301, 301, 32, 301, 32, 32]], true, [3, 2], 0, 0, 0.4);
  });
});
